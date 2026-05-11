use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{self, ClearType},
    style::{Color, SetBackgroundColor, SetForegroundColor, SetAttribute, Attribute, Print},
};
use std::io::{self, Write};
use corewar_common::constants::*;
use corewar_common::op_table::OP_TABLE;
use super::vm::Vm;

// Speed constants (matching C version)
pub const MAX_SPEED: i32 = 0;
pub const MIN_SPEED: i32 = 30000;

fn owner_color(owner: u8) -> (Color, Color) {
    match owner {
        0 => (Color::Rgb { r: 180, g: 180, b: 180 }, Color::Black),
        1 => (Color::Rgb { r: 0, g: 217, b: 217 }, Color::Black),
        2 => (Color::Rgb { r: 102, g: 102, b: 255 }, Color::Black),
        3 => (Color::Rgb { r: 230, g: 0, b: 0 }, Color::Black),
        4 => (Color::Rgb { r: 0, g: 204, b: 0 }, Color::Black),
        _ => (Color::White, Color::Black),
    }
}

fn player_panel_color(idx: usize) -> Color {
    match idx {
        0 => Color::Rgb { r: 0, g: 217, b: 217 },
        1 => Color::Rgb { r: 102, g: 102, b: 255 },
        2 => Color::Rgb { r: 230, g: 0, b: 0 },
        3 => Color::Rgb { r: 0, g: 204, b: 0 },
        _ => Color::White,
    }
}

/// A cell in our virtual screen buffer
#[derive(Clone, Copy, PartialEq)]
struct Cell {
    ch: char,
    fg: Color,
    bg: Color,
    bold: bool,
}

impl Default for Cell {
    fn default() -> Self {
        Cell { ch: ' ', fg: Color::White, bg: Color::Black, bold: false }
    }
}

/// State for the ncurses-like visualizer (using crossterm)
pub struct Visualizer {
    pub speed: i32,
    pub paused: bool,
    height: i32,
    width: i32,
    s_width: i32,
    p_height: i32,
    proc_y: i32,
    /// Virtual screen buffer — holds what's currently on screen
    screen: Vec<Vec<Cell>>,
    /// Dimensions of the virtual screen
    screen_cols: usize,
    screen_rows: usize,
}

impl Visualizer {
    /// Initialize terminal and visualizer state
    pub fn init(vm: &Vm) -> Self {
        let mut stdout = io::stdout();

        // Enter alternate screen, raw mode, disable line wrap
        execute!(stdout, terminal::EnterAlternateScreen).unwrap();
        terminal::enable_raw_mode().unwrap();
        execute!(stdout, terminal::DisableLineWrap).unwrap();
        execute!(stdout, cursor::Hide).unwrap();
        execute!(stdout, terminal::Clear(ClearType::All)).unwrap();

        let sqrt = (MEM_SIZE as f64).sqrt() as i32; // 64
        let height = sqrt;
        let width = sqrt * 3;
        let s_width = 50;
        let proc_y = (5 * vm.nplayers as i32) + 10;
        let p_height = height + 2 - proc_y;

        // Calculate total screen dimensions
        let screen_cols = (width + 2 + s_width + 2) as usize; // arena + panel
        let screen_rows = (height + 2) as usize; // max height

        // Initialize screen buffer with empty cells
        let screen = vec![vec![Cell::default(); screen_cols]; screen_rows];

        let mut vis = Visualizer {
            speed: 3000,
            paused: false,
            height,
            width,
            s_width,
            p_height,
            proc_y,
            screen,
            screen_cols,
            screen_rows,
        };

        // Render first frame to buffer
        vis.render_to_buffer(vm);
        // Paint entire buffer to terminal
        vis.paint_full();

        vis
    }

    /// Handle user input
    pub fn ncupdate(&mut self, vm: &Vm) -> i32 {
        while event::poll(std::time::Duration::from_secs(0)).unwrap_or(false) {
            if let Ok(Event::Key(key)) = event::read() {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                match key.code {
                    KeyCode::Char('q') => return 1,
                    KeyCode::Char(' ') => {
                        self.paused = !self.paused;
                    }
                    KeyCode::Up => {
                        if self.speed > MAX_SPEED {
                            self.speed -= 500;
                        }
                    }
                    KeyCode::Down => {
                        if self.speed < MIN_SPEED {
                            self.speed += 500;
                        }
                    }
                    _ => {}
                }
            }
        }

        if self.paused {
            self.diff_draw(vm);
            return 2;
        }

        if self.speed > 0 {
            std::thread::sleep(std::time::Duration::from_micros(self.speed as u64));
        }

        0
    }

    /// Render VM state into the virtual screen buffer (no terminal I/O)
    fn render_to_buffer(&mut self, vm: &Vm) {
        // Clear buffer
        for row in &mut self.screen {
            for cell in row.iter_mut() {
                cell.ch = ' ';
                cell.fg = Color::White;
                cell.bg = Color::Black;
                cell.bold = false;
            }
        }

        // Draw arena
        self.buffer_arena(vm);
        // Draw panel
        self.buffer_panel(vm);
        // Draw boxes
        self.buffer_boxes();
    }

    /// Write arena cells to virtual screen buffer
    fn buffer_arena(&mut self, vm: &Vm) {
        let per_line = self.height as usize;
        let pc_set: std::collections::HashSet<usize> = vm.processes.iter().map(|p| p.pc).collect();
        let mut ir_map: [u8; MEM_SIZE] = [0u8; MEM_SIZE];
        for proc in &vm.processes {
            if proc.ir >= 0 && proc.ir <= 15 && vm.owner[proc.pc] != 0 {
                ir_map[proc.pc] = proc.owner as u8;
            }
        }

        let mut row: usize = 1;
        let mut col: usize = 1;

        for i in 0..MEM_SIZE {
            let owner = vm.owner[i];
            let is_pc = pc_set.contains(&i);
            let ir_owner = ir_map[i];
            let is_bold = vm.scrb[i] != 0;

            let (fg, bg) = if owner == 0 && is_pc {
                (Color::Black, Color::Rgb { r: 180, g: 180, b: 180 })
            } else if ir_owner > 0 {
                let (ofg, _obg) = owner_color(ir_owner);
                (ofg, ofg)
            } else {
                owner_color(owner)
            };

            // Write "XX " (3 chars) for this byte
            let text = format!("{:02x}", vm.arena[i]);
            if row < self.screen_rows && col + 2 < self.screen_cols {
                self.screen[row][col] = Cell { ch: text.chars().next().unwrap(), fg, bg, bold: is_bold };
                self.screen[row][col + 1] = Cell { ch: text.chars().nth(1).unwrap(), fg, bg, bold: is_bold };
                self.screen[row][col + 2] = Cell { ch: ' ', fg, bg: Color::Black, bold: false };
            }

            col += 3;
            if i != 1 && (i + 1) % per_line == 0 {
                row += 1;
                col = 1;
            }
        }
    }

    /// Write panel content to virtual screen buffer
    fn buffer_panel(&mut self, vm: &Vm) {
        self.buffer_header(vm);
        self.buffer_players(vm);
        self.buffer_processes(vm);
    }

    /// Write header to buffer
    fn buffer_header(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as usize;

        let lines = [
            format!("CYCLES\t\t{}", vm.cycles),
            format!("CYCLE_TO_DIE\t{}", vm.cycle_to_die),
            format!("CYCLE_DELTA\t{}", CYCLE_DELTA),
            format!("MAX CHECKS\t{}", MAX_CHECKS),
            format!("CHECK\t\t{}", vm.nchecks),
            "__________________________________________________".to_string(),
        ];

        for (idx, line) in lines.iter().enumerate() {
            self.write_str_at(sx, 1 + idx, line, Color::White, Color::Black, true);
        }

        // Status
        let status = if self.paused { "** PAUSED **" } else { "** RUNNING **" };
        self.write_str_at(sx + 34, 1, status, Color::White, Color::Black, true);

        // Speed
        let speed_text = format!("Speed: {}", 50000 - self.speed);
        self.write_str_at(sx + 34, 2, &speed_text, Color::White, Color::Black, true);
    }

    /// Write player info to buffer
    fn buffer_players(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as usize;

        let mut i: usize = 8;
        for (idx, player) in vm.players.iter().enumerate() {
            let color = player_panel_color(idx);

            self.write_str_at(sx, i, &format!("PLAYER {}", player.nplayer), Color::White, Color::Black, true);
            self.write_str_at(sx, i + 1, &format!("\t\t({})", player.name), color, Color::Black, false);
            self.write_str_at(sx, i + 2, &format!("Last live: \t\t\t{}", player.last_live_cycle), Color::White, Color::Black, false);
            self.write_str_at(sx, i + 3, &format!("Lives in current period: \t{}", player.nblive), Color::White, Color::Black, false);
            i += 5;
        }
    }

    /// Write process info to buffer
    fn buffer_processes(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as usize;
        let sy = (self.proc_y + 1) as usize;

        let header = format!(
            " _____________PROCESSES_({:04} / {:04})_____________",
            vm.process_alive, vm.nprocess
        );
        self.write_str_at(sx, sy, &header, Color::White, Color::Black, true);

        let mut n = vm.process_alive;
        let mut i: usize = 1;

        for proc in &vm.processes {
            if i >= self.p_height as usize - 1 {
                break;
            }
            let carry_marker = if proc.carry != 0 { "*" } else { " " };
            let o_color = player_panel_color((proc.owner - 1).max(0) as usize);
            let green = Color::Rgb { r: 0, g: 204, b: 0 };
            let red = Color::Rgb { r: 230, g: 0, b: 0 };

            // Process line with carry marker
            let proc_text = format!("{}Process {:04}  PC:", carry_marker, n);
            self.write_str_at(sx + 1, sy + i, &proc_text, o_color, Color::Black, false);

            // PC value
            let pc_text = format!("{:04}", proc.pc);
            self.write_str_at(sx + 18, sy + i, &pc_text, Color::White, Color::Black, false);

            // OP: label
            self.write_str_at(sx + 23, sy + i, "OP: ", o_color, Color::Black, false);

            // Opcode name
            let op_name = if proc.last_ir > 0 && proc.last_ir <= 16 {
                OP_TABLE[proc.last_ir as usize - 1].name
            } else {
                "____"
            };
            self.write_str_at(sx + 27, sy + i, op_name, green, Color::Black, true);

            // Registers
            for x in 0..REG_NUMBER {
                let (ch, color) = if proc.reg[x] != 0 { ('x', green) } else { ('.', red) };
                let col = sx + 33 + x;
                if col < self.screen_cols && sy + i < self.screen_rows {
                    self.screen[sy + i][col] = Cell { ch, fg: color, bg: Color::Black, bold: true };
                }
            }

            i += 1;
            n -= 1;
        }
    }

    /// Write box borders to buffer
    fn buffer_boxes(&mut self) {
        self.buffer_box(0, 0, self.width + 2, self.height + 2);
        self.buffer_box(self.width + 2, 0, self.s_width + 2, self.height - self.p_height + 2);
        self.buffer_box(self.width + 2, self.proc_y, self.s_width + 2, self.p_height);
    }

    fn buffer_box(&mut self, x: i32, y: i32, w: i32, h: i32) {
        let border = Cell { ch: ' ', fg: Color::White, bg: Color::Black, bold: false };
        let xu = x as usize;
        let yu = y as usize;
        let wu = w as usize;
        let hu = h as usize;

        // Top line
        if yu < self.screen_rows {
            for c in (xu + 1)..(xu + wu - 1) {
                if c < self.screen_cols {
                    self.screen[yu][c] = Cell { ch: '─', ..border };
                }
            }
        }
        // Bottom line
        let by = yu + hu - 1;
        if by < self.screen_rows {
            for c in (xu + 1)..(xu + wu - 1) {
                if c < self.screen_cols {
                    self.screen[by][c] = Cell { ch: '─', ..border };
                }
            }
        }
        // Vertical lines
        for r in (yu + 1)..by {
            if r < self.screen_rows {
                if xu < self.screen_cols {
                    self.screen[r][xu] = Cell { ch: '│', ..border };
                }
                let rx = xu + wu - 1;
                if rx < self.screen_cols {
                    self.screen[r][rx] = Cell { ch: '│', ..border };
                }
            }
        }
        // Corners
        let corners = [
            (xu, yu, '┌'),
            (xu + wu - 1, yu, '┐'),
            (xu, by, '└'),
            (xu + wu - 1, by, '┘'),
        ];
        for (cx, cy, ch) in corners {
            if cy < self.screen_rows && cx < self.screen_cols {
                self.screen[cy][cx] = Cell { ch, ..border };
            }
        }
    }

    /// Helper: write a string to the virtual buffer at (col, row)
    fn write_str_at(&mut self, col: usize, row: usize, s: &str, fg: Color, bg: Color, bold: bool) {
        if row >= self.screen_rows {
            return;
        }
        for (i, ch) in s.chars().enumerate() {
            let c = col + i;
            if c >= self.screen_cols {
                break;
            }
            self.screen[row][c] = Cell { ch, fg, bg, bold };
        }
    }

    /// Paint the entire virtual buffer to the terminal in one shot
    fn paint_full(&self) {
        let mut buf = Vec::with_capacity(self.screen_rows * self.screen_cols * 8);
        let mut stdout = io::stdout();

        for (row_idx, row) in self.screen.iter().enumerate() {
            for (col_idx, cell) in row.iter().enumerate() {
                if cell.ch == ' ' && cell.bg == Color::Black {
                    continue; // Skip empty cells on black background
                }
                // Move cursor, set colors, write char
                let _ = crossterm::queue!(
                    buf,
                    cursor::MoveTo(col_idx as u16, row_idx as u16),
                    SetBackgroundColor(cell.bg),
                    SetForegroundColor(cell.fg),
                    if cell.bold { SetAttribute(Attribute::Bold) } else { SetAttribute(Attribute::Reset) },
                    Print(cell.ch),
                );
            }
        }

        // Reset attributes and write ALL at once
        let _ = crossterm::queue!(buf, SetAttribute(Attribute::Reset), SetBackgroundColor(Color::Black));
        let _ = stdout.write_all(&buf);
        let _ = stdout.flush();
    }

    /// Differential draw — compare buffer with previous, only output changes
    pub fn diff_draw(&mut self, vm: &Vm) {
        // Save old buffer
        let old_screen = self.screen.clone();

        // Render new state into buffer
        self.render_to_buffer(vm);

        // Build output with only differences
        let mut buf = Vec::with_capacity(4096 * 6); // pre-allocate reasonable size
        let mut stdout = io::stdout();

        for (row_idx, (new_row, old_row)) in self.screen.iter().zip(old_screen.iter()).enumerate() {
            for (col_idx, (new_cell, old_cell)) in new_row.iter().zip(old_row.iter()).enumerate() {
                if new_cell != old_cell {
                    let _ = crossterm::queue!(
                        buf,
                        cursor::MoveTo(col_idx as u16, row_idx as u16),
                        SetBackgroundColor(new_cell.bg),
                        SetForegroundColor(new_cell.fg),
                        if new_cell.bold { SetAttribute(Attribute::Bold) } else { SetAttribute(Attribute::Reset) },
                        Print(new_cell.ch),
                    );
                }
            }
        }

        // Reset and write ALL at once
        let _ = crossterm::queue!(buf, SetAttribute(Attribute::Reset), SetBackgroundColor(Color::Black));
        if !buf.is_empty() {
            let _ = stdout.write_all(&buf);
            let _ = stdout.flush();
        }
    }

    /// Display the winner screen
    pub fn show_winner(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as usize;
        let sy = (self.proc_y + 1) as usize;

        // Clear process area in buffer
        for r in sy..self.screen_rows {
            for cell in self.screen[r].iter_mut() {
                cell.ch = ' ';
                cell.fg = Color::White;
                cell.bg = Color::Black;
                cell.bold = false;
            }
        }

        // Header
        let header = format!(
            " _____________PROCESSES_(0000 / {:04})_____________",
            vm.nprocess
        );
        self.write_str_at(sx, sy, &header, Color::White, Color::Black, true);

        // Winner info
        for (idx, player) in vm.players.iter().enumerate() {
            if player.nplayer == vm.last_alive {
                let color = player_panel_color(idx);
                let mid = (self.p_height / 2) as usize;

                self.write_str_at(sx + 2, sy + mid - 3, "WINNER!", color, Color::Black, false);
                self.write_str_at(sx + 5, sy + mid - 1, &format!("PLAYER: {}", vm.last_alive), color, Color::Black, false);
                self.write_str_at(sx + 5, sy + mid, &player.name, color, Color::Black, false);
                break;
            }
        }

        self.buffer_box(self.width + 2, self.proc_y, self.s_width + 2, self.p_height);
        self.paint_full();
    }

    /// Clean up terminal
    pub fn end(&mut self) {
        let mut stdout = io::stdout();
        let _ = execute!(stdout, terminal::EnableLineWrap);
        let _ = execute!(stdout, cursor::Show);
        let _ = execute!(stdout, terminal::LeaveAlternateScreen);
        let _ = terminal::disable_raw_mode();
    }

    /// Wait for a key press (blocking)
    pub fn wait_for_key(&self) {
        let _ = event::read();
    }
}
