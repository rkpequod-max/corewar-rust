use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyEventKind},
    execute, queue,
    terminal::{self, ClearType},
    style::{Color, SetBackgroundColor, SetForegroundColor, SetAttribute, Attribute, Print},
};
use std::io::{self, Write, BufWriter};
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

/// A cell in the arena cache — tracks what was last drawn to avoid redundant writes
#[derive(Clone, Copy, PartialEq)]
struct ArenaCell {
    byte: u8,
    owner: u8,
    scrb: u8,
    is_pc: bool,
    ir_owner: u8,
}

impl Default for ArenaCell {
    fn default() -> Self {
        ArenaCell { byte: 0, owner: 0, scrb: 0, is_pc: false, ir_owner: 0 }
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
    /// Cache of last-rendered arena state for differential updates
    arena_cache: [ArenaCell; MEM_SIZE],
    /// Cache of last-rendered panel state
    last_cycles: i32,
    last_cycle_to_die: i32,
    last_nchecks: i32,
    last_process_alive: i32,
    last_nprocess: i32,
    last_speed: i32,
    last_paused: bool,
    /// Whether this is the first frame (full draw needed)
    first_frame: bool,
}

impl Visualizer {
    /// Initialize terminal and visualizer state
    pub fn init(vm: &Vm) -> Self {
        let stdout = io::stdout();
        let mut buf = BufWriter::new(stdout);

        // Enter alternate screen, raw mode, disable line wrap
        execute!(buf, terminal::EnterAlternateScreen).unwrap();
        terminal::enable_raw_mode().unwrap();
        execute!(buf, terminal::DisableLineWrap).unwrap();

        // Hide cursor
        execute!(buf, cursor::Hide).unwrap();

        // Clear screen ONCE at init
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
            arena_cache: [ArenaCell::default(); MEM_SIZE],
            last_cycles: -1,
            last_cycle_to_die: -1,
            last_nchecks: -1,
            last_process_alive: -1,
            last_nprocess: -1,
            last_speed: -1,
            last_paused: false,
            first_frame: true,
        };

        vis.full_draw(vm);
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

    /// Full redraw — only on first frame
    fn full_draw(&mut self, vm: &Vm) {
        let _ = queue!(self.stdout, terminal::Clear(ClearType::All));
        self.draw_arena_full(vm);
        self.draw_panel(vm);
        self.draw_boxes();
        let _ = self.stdout.flush();
        self.update_cache(vm);
        self.first_frame = false;
    }

    /// Differential draw — only update what changed
    pub fn diff_draw(&mut self, vm: &Vm) {
        let pc_set: std::collections::HashSet<usize> = vm.processes.iter().map(|p| p.pc).collect();
        let mut ir_map: [u8; MEM_SIZE] = [0u8; MEM_SIZE];
        for proc in &vm.processes {
            if proc.ir >= 0 && proc.ir <= 15 && vm.owner[proc.pc] != 0 {
                ir_map[proc.pc] = proc.owner as u8;
            }
        }

        let per_line = self.height as usize;
        let mut arena_changed = false;

        // Only write arena cells that have changed
        for i in 0..MEM_SIZE {
            let is_pc = pc_set.contains(&i);
            let ir_owner = ir_map[i];
            let current = ArenaCell {
                byte: vm.arena[i],
                owner: vm.owner[i],
                scrb: vm.scrb[i],
                is_pc,
                ir_owner,
            };

            if self.first_frame || self.arena_cache[i] != current {
                let row = 1 + (i / per_line) as u16;
                let col = 1 + ((i % per_line) * 3) as u16;

                let (fg, bg) = if current.owner == 0 && current.is_pc {
                    (Color::Black, Color::Rgb { r: 180, g: 180, b: 180 })
                } else if current.ir_owner > 0 {
                    let (ofg, _obg) = owner_color(current.ir_owner);
                    (ofg, ofg)
                } else {
                    owner_color(current.owner)
                };

                let text = format!("{:02x} ", current.byte);
                let is_bold = current.scrb != 0;

                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(col, row),
                    SetForegroundColor(fg),
                    SetBackgroundColor(bg),
                    if is_bold { SetAttribute(Attribute::Bold) } else { SetAttribute(Attribute::Reset) },
                    Print(&text),
                    SetAttribute(Attribute::Reset),
                    SetBackgroundColor(Color::Black),
                );

                self.arena_cache[i] = current;
                arena_changed = true;
            }
        }

        // Update panel if any state changed
        let panel_changed = vm.cycles != self.last_cycles
            || vm.cycle_to_die != self.last_cycle_to_die
            || vm.nchecks != self.last_nchecks
            || vm.process_alive != self.last_process_alive
            || vm.nprocess != self.last_nprocess
            || self.speed != self.last_speed
            || self.paused != self.last_paused;

        if panel_changed || arena_changed || self.first_frame {
            self.draw_panel(vm);
            if arena_changed || self.first_frame {
                self.draw_boxes();
            }
        }

        let _ = self.stdout.flush();
        self.update_cache(vm);
    }

    fn update_cache(&mut self, vm: &Vm) {
        self.last_cycles = vm.cycles;
        self.last_cycle_to_die = vm.cycle_to_die;
        self.last_nchecks = vm.nchecks;
        self.last_process_alive = vm.process_alive;
        self.last_nprocess = vm.nprocess;
        self.last_speed = self.speed;
        self.last_paused = self.paused;
    }

    /// Draw the three window borders
    fn draw_boxes(&mut self) {
        self.draw_box(0, 0, self.width + 2, self.height + 2);
        self.draw_box(self.width + 2, 0, self.s_width + 2, self.height - self.p_height + 2);
        self.draw_box(self.width + 2, self.proc_y, self.s_width + 2, self.p_height);
    }

    /// Draw a box border
    fn draw_box(&mut self, x: i32, y: i32, w: i32, h: i32) {
        let white = SetForegroundColor(Color::White);
        let black_bg = SetBackgroundColor(Color::Black);
        let reset = SetAttribute(Attribute::Reset);

        // Top horizontal line
        let _ = queue!(
            self.stdout,
            cursor::MoveTo((x + 1) as u16, y as u16),
            black_bg, white, Print("─".repeat((w - 2) as usize)), reset
        );
        // Bottom horizontal line
        let _ = queue!(
            self.stdout,
            cursor::MoveTo((x + 1) as u16, (y + h - 1) as u16),
            black_bg, white, Print("─".repeat((w - 2) as usize)), reset
        );
        // Vertical lines
        for row in (y + 1)..(y + h - 1) {
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(x as u16, row as u16),
                black_bg, white, Print("│"), reset
            );
            let _ = queue!(
                self.stdout,
                cursor::MoveTo((x + w - 1) as u16, row as u16),
                black_bg, white, Print("│"), reset
            );
        }
        // Corners
        let _ = queue!(self.stdout, cursor::MoveTo(x as u16, y as u16), black_bg, white, Print("┌"), reset);
        let _ = queue!(self.stdout, cursor::MoveTo((x + w - 1) as u16, y as u16), black_bg, white, Print("┐"), reset);
        let _ = queue!(self.stdout, cursor::MoveTo(x as u16, (y + h - 1) as u16), black_bg, white, Print("└"), reset);
        let _ = queue!(self.stdout, cursor::MoveTo((x + w - 1) as u16, (y + h - 1) as u16), black_bg, white, Print("┘"), reset);
    }

    /// Full arena draw — all 4096 cells
    fn draw_arena_full(&mut self, vm: &Vm) {
        let per_line = self.height as usize;
        let pc_set: std::collections::HashSet<usize> = vm.processes.iter().map(|p| p.pc).collect();
        let mut ir_map: [u8; MEM_SIZE] = [0u8; MEM_SIZE];
        for proc in &vm.processes {
            if proc.ir >= 0 && proc.ir <= 15 && vm.owner[proc.pc] != 0 {
                ir_map[proc.pc] = proc.owner as u8;
            }
        }

        let mut row: u16 = 1;
        let mut col: u16 = 1;

        for i in 0..MEM_SIZE {
            let owner = vm.owner[i];
            let is_pc = pc_set.contains(&i);
            let ir_owner = ir_map[i];

            let (fg, bg) = if owner == 0 && is_pc {
                (Color::Black, Color::Rgb { r: 180, g: 180, b: 180 })
            } else if ir_owner > 0 {
                let (ofg, _obg) = owner_color(ir_owner);
                (ofg, ofg)
            } else {
                owner_color(owner)
            };

            let text = format!("{:02x} ", vm.arena[i]);
            let is_bold = vm.scrb[i] != 0;

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(col, row),
                SetForegroundColor(fg),
                SetBackgroundColor(bg),
                if is_bold { SetAttribute(Attribute::Bold) } else { SetAttribute(Attribute::Reset) },
                Print(&text),
                SetAttribute(Attribute::Reset),
                SetBackgroundColor(Color::Black),
            );

            col += 3;
            if i != 1 && (i + 1) % per_line == 0 {
                row += 1;
                col = 1;
            }
        }
    }

    /// Draw panel — header + players + processes
    /// NO Clear(CurrentLine) — instead overwrite with padded strings
    fn draw_panel(&mut self, vm: &Vm) {
        self.draw_header(vm);
        self.draw_players(vm);
        self.draw_processes(vm);
    }

    /// Draw header info — pads strings with spaces to overwrite old content
    fn draw_header(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let white = SetForegroundColor(Color::White);
        let black_bg = SetBackgroundColor(Color::Black);

        // Pad each line to s_width to overwrite any previous content
        let pad = self.s_width as usize;

        let lines = [
            format!("{:width$}", format!("CYCLES\t\t{}", vm.cycles), width = pad),
            format!("{:width$}", format!("CYCLE_TO_DIE\t{}", vm.cycle_to_die), width = pad),
            format!("{:width$}", format!("CYCLE_DELTA\t{}", CYCLE_DELTA), width = pad),
            format!("{:width$}", format!("MAX CHECKS\t{}", MAX_CHECKS), width = pad),
            format!("{:width$}", format!("CHECK\t\t{}", vm.nchecks), width = pad),
            format!("{:width$}", "__________________________________________________", width = pad),
        ];

        for (idx, line) in lines.iter().enumerate() {
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, (1 + idx) as u16),
                black_bg, bold, white, Print(line), reset,
            );
        }

        // Status on line 1, column offset 34
        let status = if self.paused { "** PAUSED **" } else { "** RUNNING **" };
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx + 34, 1),
            black_bg, bold, white, Print(status), reset,
        );

        // Speed on line 2, column offset 34
        let speed_text = format!("Speed: {}", 50000 - self.speed);
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx + 34, 2),
            black_bg, bold, white, Print(&speed_text), reset,
        );
    }

    /// Draw player information
    fn draw_players(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let white = SetForegroundColor(Color::White);
        let black_bg = SetBackgroundColor(Color::Black);
        let pad = self.s_width as usize;

        let mut i: u16 = 8;
        for (idx, player) in vm.players.iter().enumerate() {
            let color = player_panel_color(idx);
            let fg = SetForegroundColor(color);

            // Clear 4 lines per player by writing padded strings
            let line0 = format!("{:width$}", format!("PLAYER {}", player.nplayer), width = pad);
            let line1 = format!("{:width$}", format!("\t\t({})", player.name), width = pad);
            let line2 = format!("{:width$}", format!("Last live: \t\t\t{}", player.last_live_cycle), width = pad);
            let line3 = format!("{:width$}", format!("Lives in current period: \t{}", player.nblive), width = pad);

            let _ = queue!(self.stdout, cursor::MoveTo(sx, i), black_bg, bold, white, Print(&line0), reset);
            let _ = queue!(self.stdout, cursor::MoveTo(sx, i + 1), black_bg, fg, Print(&line1), reset);
            let _ = queue!(self.stdout, cursor::MoveTo(sx, i + 2), black_bg, white, Print(&line2), reset);
            let _ = queue!(self.stdout, cursor::MoveTo(sx, i + 3), black_bg, white, Print(&line3), reset);

            i += 5;
        }
    }

    /// Draw processes in the bottom-right window
    fn draw_processes(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let sy = (self.proc_y + 1) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let black_bg = SetBackgroundColor(Color::Black);
        let pad = self.s_width as usize;

        // Header line — padded
        let header = format!(
            "{:width$}",
            format!(" _____________PROCESSES_({:04} / {:04})_____________", vm.process_alive, vm.nprocess),
            width = pad
        );
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx, sy),
            black_bg, bold, SetForegroundColor(Color::White), Print(&header), reset,
        );

        let mut n = vm.process_alive;
        let mut i: u16 = 1;

        for proc in &vm.processes {
            if i >= self.p_height as u16 - 1 {
                break;
            }
            let carry_marker = if proc.carry != 0 { "*" } else { " " };
            let o_color = player_panel_color((proc.owner - 1).max(0) as usize);
            let fg = SetForegroundColor(o_color);
            let _green_fg = SetForegroundColor(Color::Rgb { r: 0, g: 204, b: 0 });

            // Build the full process line and pad it
            let proc_line = format!("{}Process {:04}  PC:{:04} OP: {}", carry_marker, n, proc.pc, 
                if proc.last_ir > 0 && proc.last_ir <= 16 {
                    OP_TABLE[proc.last_ir as usize - 1].name
                } else {
                    "____"
                }
            );
            let padded_line = format!("{:width$}", proc_line, width = pad);

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, sy + i),
                black_bg, fg, Print(&padded_line), reset,
            );

            // Registers — overwrite specific positions
            for x in 0..REG_NUMBER {
                let ch = if proc.reg[x] != 0 { "x" } else { "." };
                let color = if proc.reg[x] != 0 {
                    Color::Rgb { r: 0, g: 204, b: 0 }
                } else {
                    Color::Rgb { r: 230, g: 0, b: 0 }
                };
                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 33 + x as u16, sy + i),
                    black_bg, bold, SetForegroundColor(color), Print(ch), reset,
                );
            }

            i += 1;
            n -= 1;
        }

        // Clear remaining lines in the process area (in case process count decreased)
        while i < self.p_height as u16 - 1 {
            let blank = " ".repeat(pad);
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, sy + i),
                black_bg, Print(&blank), reset,
            );
            i += 1;
        }
    }

    /// Display the winner screen
    pub fn show_winner(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let sy = (self.proc_y + 1) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let black_bg = SetBackgroundColor(Color::Black);
        let pad = self.s_width as usize;

        // Clear process area by writing blank padded lines
        for r in 0..(self.p_height - 1) {
            let blank = " ".repeat(pad);
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, sy + r as u16),
                black_bg, Print(&blank), reset,
            );
        }

        // Header
        let header = format!(
            "{:width$}",
            format!(" _____________PROCESSES_(0000 / {:04})_____________", vm.nprocess),
            width = pad
        );
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx, sy),
            black_bg, bold, SetForegroundColor(Color::White), Print(&header), reset,
        );

        for (idx, player) in vm.players.iter().enumerate() {
            if player.nplayer == vm.last_alive {
                let color = player_panel_color(idx);
                let fg = SetForegroundColor(color);
                let mid = (self.p_height / 2) as u16;

                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 2, sy + mid - 3),
                    black_bg, fg, Print("WINNER!"), reset,
                );
                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 5, sy + mid - 1),
                    black_bg, fg, Print(format!("PLAYER: {}", vm.last_alive)), reset,
                );
                let _ = queue!(
                    self.stdout,
                    cursor::MoveTo(sx + 5, sy + mid),
                    black_bg, fg, Print(&player.name), reset,
                );
                break;
            }
        }

        self.draw_box(self.width + 2, self.proc_y, self.s_width + 2, self.p_height);
        let _ = self.stdout.flush();
    }

    /// Clean up terminal
    pub fn end(&mut self) {
        let _ = execute!(self.stdout, terminal::EnableLineWrap);
        let _ = execute!(self.stdout, cursor::Show);
        let _ = execute!(self.stdout, terminal::LeaveAlternateScreen);
        let _ = terminal::disable_raw_mode();
    }

    /// Wait for a key press (blocking)
    pub fn wait_for_key(&self) {
        let _ = event::read();
    }
}
