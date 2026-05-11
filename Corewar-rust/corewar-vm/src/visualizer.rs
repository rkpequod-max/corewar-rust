use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyEventKind},
    execute, queue, style,
    terminal::{self, ClearType},
    style::{Color, SetBackgroundColor, SetForegroundColor, SetAttribute, Attribute, Print, ContentStyle},
};
use std::io::{self, Write, BufWriter};
use corewar_common::constants::*;
use corewar_common::op_table::OP_TABLE;
use super::vm::Vm;

// Speed constants (matching C version)
pub const MAX_SPEED: i32 = 0;
pub const MIN_SPEED: i32 = 30000;

// Color mapping matching C version color pairs
// CP 1 = gray/yellow on black, CP 2 = cyan, CP 3 = blue, CP 4 = red, CP 5 = green
// CP 6 = black on gray (for PC on empty cell)
fn owner_color(owner: u8) -> (Color, Color) {
    match owner {
        0 => (Color::Rgb { r: 180, g: 180, b: 180 }, Color::Black), // gray on black
        1 => (Color::Rgb { r: 0, g: 217, b: 217 }, Color::Black),   // cyan on black
        2 => (Color::Rgb { r: 102, g: 102, b: 255 }, Color::Black), // blue on black
        3 => (Color::Rgb { r: 230, g: 0, b: 0 }, Color::Black),     // red on black
        4 => (Color::Rgb { r: 0, g: 204, b: 0 }, Color::Black),     // green on black
        _ => (Color::White, Color::Black),
    }
}

fn player_panel_color(idx: usize) -> Color {
    match idx {
        0 => Color::Rgb { r: 0, g: 217, b: 217 },   // cyan
        1 => Color::Rgb { r: 102, g: 102, b: 255 },  // blue
        2 => Color::Rgb { r: 230, g: 0, b: 0 },      // red
        3 => Color::Rgb { r: 0, g: 204, b: 0 },       // green
        _ => Color::White,
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
    stdout: BufWriter<io::Stdout>,
}

impl Visualizer {
    /// Initialize terminal and visualizer state (mirrors C's print_arena)
    pub fn init(vm: &Vm) -> Self {
        let stdout = io::stdout();
        let mut buf = BufWriter::new(stdout);

        // Enter alternate screen and raw mode
        execute!(buf, terminal::EnterAlternateScreen).unwrap();
        terminal::enable_raw_mode().unwrap();

        // Hide cursor
        execute!(buf, cursor::Hide).unwrap();

        // Clear screen
        execute!(buf, terminal::Clear(ClearType::All)).unwrap();

        let sqrt = (MEM_SIZE as f64).sqrt() as i32; // 64
        let height = sqrt;
        let width = sqrt * 3;
        let s_width = 50;
        let proc_y = (5 * vm.nplayers as i32) + 10;
        let p_height = height + 2 - proc_y;

        let mut vis = Visualizer {
            speed: 3000,
            paused: false,
            height,
            width,
            s_width,
            p_height,
            proc_y,
            stdout: buf,
        };

        vis.refresh_all(vm);
        vis
    }

    /// Handle user input, returns:
    ///   0 = continue running
    ///   1 = quit
    ///   2 = paused (skip this cycle)
    pub fn ncupdate(&mut self, vm: &Vm) -> i32 {
        // Non-blocking poll for input
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
            self.refresh_all(vm);
            return 2;
        }

        // Sleep to control speed (matching C's usleep)
        if self.speed > 0 {
            std::thread::sleep(std::time::Duration::from_micros(self.speed as u64));
        }

        0
    }

    /// Redraw all windows
    pub fn refresh_all(&mut self, vm: &Vm) {
        // Clear entire screen
        let _ = queue!(self.stdout, terminal::Clear(ClearType::All));

        // Draw the three "windows" as bordered regions
        self.fill_arena(vm);
        self.print_panel(vm);
        self.draw_box(0, 0, self.width + 2, self.height + 2); // m_win
        self.draw_box(self.width + 2, 0, self.s_width + 2, self.height - self.p_height + 2); // s_win
        self.draw_box(self.width + 2, self.proc_y, self.s_width + 2, self.p_height); // p_win

        let _ = self.stdout.flush();
    }

    /// Draw a simple box border around a region (matching C's box())
    fn draw_box(&mut self, x: i32, y: i32, w: i32, h: i32) {
        let _style = ContentStyle::new();
        let _fg = SetForegroundColor(Color::White);
        let attr = SetAttribute(Attribute::Reset);

        // Top and bottom horizontal lines
        for col in (x + 1)..(x + w - 1) {
            let _ = queue!(self.stdout, cursor::MoveTo(col as u16, y as u16), style::Print("─"), attr);
            let _ = queue!(self.stdout, cursor::MoveTo(col as u16, (y + h - 1) as u16), style::Print("─"), attr);
        }

        // Left and right vertical lines
        for row in (y + 1)..(y + h - 1) {
            let _ = queue!(self.stdout, cursor::MoveTo(x as u16, row as u16), style::Print("│"), attr);
            let _ = queue!(self.stdout, cursor::MoveTo((x + w - 1) as u16, row as u16), style::Print("│"), attr);
        }

        // Corners
        let _ = queue!(self.stdout, cursor::MoveTo(x as u16, y as u16), style::Print("┌"), attr);
        let _ = queue!(self.stdout, cursor::MoveTo((x + w - 1) as u16, y as u16), style::Print("┐"), attr);
        let _ = queue!(self.stdout, cursor::MoveTo(x as u16, (y + h - 1) as u16), style::Print("└"), attr);
        let _ = queue!(self.stdout, cursor::MoveTo((x + w - 1) as u16, (y + h - 1) as u16), style::Print("┘"), attr);
    }

    /// Fill the arena window with colored memory cells (mirrors C's fill_arena)
    fn fill_arena(&mut self, vm: &Vm) {
        let mut row: i32 = 1;
        let mut col: i32 = 1;
        let per_line = self.height as usize; // bytes per line = sqrt(MEM_SIZE) = 64

        // Pre-compute PC positions for quick lookup
        let pc_set: std::collections::HashSet<usize> = vm.processes.iter().map(|p| p.pc).collect();

        for i in 0..MEM_SIZE {
            let owner = vm.owner[i];
            let is_pc = pc_set.contains(&i);

            // Find if a process at this position has an active IR
            let ir_owner: Option<u8> = vm.processes.iter()
                .find(|p| p.pc == i && p.ir >= 0 && p.ir <= 15 && owner != 0)
                .map(|p| p.owner as u8);

            // Determine colors
            let (fg, bg) = if owner == 0 && is_pc {
                // C's color pair 6: black on yellow/gray
                (Color::Black, Color::Rgb { r: 180, g: 180, b: 180 })
            } else if let Some(ow) = ir_owner {
                // A_STANDOUT | COLOR_PAIR(ow + 1) — reverse video with owner color
                let (ofg, _obg) = owner_color(ow + 1);
                (ofg, ofg) // standout effect: fg and bg same color (inverted by terminal)
            } else {
                owner_color(owner)
            };

            let text = format!("{:02x} ", vm.arena[i]);
            let is_bold = vm.scrb[i] != 0;

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(col as u16, row as u16),
                SetForegroundColor(fg),
                SetBackgroundColor(bg),
                if is_bold { SetAttribute(Attribute::Bold) } else { SetAttribute(Attribute::Reset) },
                Print(&text),
                SetAttribute(Attribute::Reset),
            );

            col += 3;
            if i != 1 && (i + 1) % per_line == 0 {
                row += 1;
                col = 1;
            }
        }
    }

    /// Print the side panel (info + players + processes) — mirrors C's print_panel
    fn print_panel(&mut self, vm: &Vm) {
        self.print_header(vm);
        self.print_players(vm);
        self.print_processes(vm);
    }

    /// Print header info (cycles, speed, etc.) — mirrors C's print_header
    fn print_header(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16; // start column (inside box border)
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let white = SetForegroundColor(Color::White);

        let lines = [
            format!("CYCLES\t\t{}", vm.cycles),
            format!("CYCLE_TO_DIE\t{}", vm.cycle_to_die),
            format!("CYCLE_DELTA\t{}", CYCLE_DELTA),
            format!("MAX CHECKS\t{}", MAX_CHECKS),
            format!("CHECK\t\t{}", vm.nchecks),
            "__________________________________________________".to_string(),
        ];

        for (idx, line) in lines.iter().enumerate() {
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, (1 + idx) as u16),
                bold, white, Print(line), reset,
            );
        }

        // Status (PAUSED / RUNNING) — line 1, column 35
        let status = if self.paused { "** PAUSED **" } else { "** RUNNING **" };
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx + 34, 1),
            bold, white, Print(status), reset,
        );

        // Speed — line 2, column 35
        let speed_text = format!("Speed: {}", 50000 - self.speed);
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx + 34, 2),
            bold, white, Print(&speed_text), reset,
        );
    }

    /// Print player information — mirrors C's print_panel player section
    fn print_players(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let white = SetForegroundColor(Color::White);

        let mut i: u16 = 8;
        for (idx, player) in vm.players.iter().enumerate() {
            let color = player_panel_color(idx);
            let fg = SetForegroundColor(color);

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i),
                bold, white, Print(format!("PLAYER {}", player.nplayer)), reset,
            );

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i + 1),
                fg, Print(format!("\t\t({})", player.name)), reset,
            );

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i + 2),
                white, Print(format!("Last live: \t\t\t{}", player.last_live_cycle)), reset,
            );

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i + 3),
                white, Print(format!("Lives in current period: \t{}", player.nblive)), reset,
            );

            i += 5;
        }
    }

    /// Print processes in the bottom-right window — mirrors C's print_processes
    fn print_processes(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let sy = (self.proc_y + 1) as u16; // inside box border
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);

        // Header line
        let header = format!(
            " _____________PROCESSES_({:04} / {:04})_____________",
            vm.process_alive, vm.nprocess
        );
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx, sy),
            bold, SetForegroundColor(Color::White), Print(&header), reset,
        );

        let mut n = vm.process_alive;
        let mut i: u16 = 1;

        for proc in &vm.processes {
            if i >= self.p_height as u16 - 1 {
                break;
            }
            let carry_marker = if proc.carry != 0 { "*" } else { " " };
            let owner_color = player_panel_color((proc.owner - 1).max(0) as usize);
            let fg = SetForegroundColor(owner_color);
            let green_fg = SetForegroundColor(Color::Rgb { r: 0, g: 204, b: 0 });
            let _red_fg = SetForegroundColor(Color::Rgb { r: 230, g: 0, b: 0 });

            // Process line: "*Process XXXX  PC:" or "Process XXXX  PC:"
            let proc_text = format!("{}Process {:04}  PC:", carry_marker, n);
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 1, sy + i),
                fg, Print(&proc_text), reset,
            );

            // PC value
            let pc_text = format!("{:04}", proc.pc);
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 18, sy + i),
                SetForegroundColor(Color::White), Print(&pc_text), reset,
            );

            // "OP: " label
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 23, sy + i),
                fg, Print("OP: "), reset,
            );

            // Opcode name
            let op_name = if proc.last_ir > 0 && proc.last_ir <= 16 {
                OP_TABLE[proc.last_ir as usize - 1].name
            } else {
                "____"
            };
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 27, sy + i),
                bold, green_fg, Print(op_name), reset,
            );

            // Registers
            for x in 0..REG_NUMBER {
                let ch = if proc.reg[x] != 0 { "x" } else { "." };
                let color = if proc.reg[x] != 0 {
                    Color::Rgb { r: 0, g: 204, b: 0 } // green
                } else {
                    Color::Rgb { r: 230, g: 0, b: 0 } // red
                };
                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 33 + x as u16, sy + i),
                    bold, SetForegroundColor(color), Print(ch), reset,
                );
            }

            i += 1;
            n -= 1;
        }
    }

    /// Display the winner screen — mirrors C's champion_won
    pub fn show_winner(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let sy = (self.proc_y + 1) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);

        // Clear the process area
        for r in 0..self.p_height {
            let _ = queue!(
                self.stdout,
                cursor::MoveTo((self.width + 2) as u16, (self.proc_y + r) as u16),
                terminal::Clear(ClearType::CurrentLine),
            );
        }

        // Header
        let header = format!(
            " _____________PROCESSES_(0000 / {:04})_____________",
            vm.nprocess
        );
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx, sy),
            bold, SetForegroundColor(Color::White), Print(&header), reset,
        );

        // Find the winning player and display
        for (idx, player) in vm.players.iter().enumerate() {
            if player.nplayer == vm.last_alive {
                let color = player_panel_color(idx);
                let fg = SetForegroundColor(color);
                let mid = (self.p_height / 2) as u16;

                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 2, sy + mid - 3),
                    fg, Print("WINNER!"), reset,
                );

                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 5, sy + mid - 1),
                    fg, Print(format!("PLAYER: {}", vm.last_alive)), reset,
                );

                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 5, sy + mid),
                    fg, Print(&player.name), reset,
                );
                break;
            }
        }

        // Redraw box for p_win
        self.draw_box(self.width + 2, self.proc_y, self.s_width + 2, self.p_height);
        let _ = self.stdout.flush();
    }

    /// Clean up terminal (mirrors C's endwin)
    pub fn end(&mut self) {
        let _ = execute!(self.stdout, cursor::Show);
        let _ = execute!(self.stdout, terminal::LeaveAlternateScreen);
        let _ = terminal::disable_raw_mode();
    }

    /// Wait for a key press (blocking) — for "press any key" after winner
    pub fn wait_for_key(&self) {
        // Need to use blocking read since we're in raw mode
        let _ = event::read();
    }
}
