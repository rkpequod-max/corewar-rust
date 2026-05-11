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

// Color mapping matching C version color pairs
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
    ir_owner: u8, // 0 = no IR, 1-4 = player owner with active IR
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
    /// Cache of last-rendered panel state (cycles, speed, etc.)
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
    /// Initialize terminal and visualizer state (mirrors C's print_arena)
    pub fn init(vm: &Vm) -> Self {
        let stdout = io::stdout();
        let mut buf = BufWriter::new(stdout);

        // Enter alternate screen and raw mode
        execute!(buf, terminal::EnterAlternateScreen).unwrap();
        terminal::enable_raw_mode().unwrap();

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
            self.diff_draw(vm);
            return 2;
        }

        // Sleep to control speed (matching C's usleep)
        if self.speed > 0 {
            std::thread::sleep(std::time::Duration::from_micros(self.speed as u64));
        }

        0
    }

    /// Full redraw — only used on first frame. Draws everything from scratch.
    fn full_draw(&mut self, vm: &Vm) {
        let _ = queue!(self.stdout, terminal::Clear(ClearType::All));
        self.draw_arena_full(vm);
        self.draw_panel_full(vm);
        self.draw_boxes();
        let _ = self.stdout.flush();
        self.update_cache(vm);
        self.first_frame = false;
    }

    /// Differential draw — only update cells that changed since last frame.
    /// This is the key to eliminating flicker: we only write what's different.
    pub fn diff_draw(&mut self, vm: &Vm) {
        // Compute current PC set and IR map
        let pc_set: std::collections::HashSet<usize> = vm.processes.iter().map(|p| p.pc).collect();
        let mut ir_map: [u8; MEM_SIZE] = [0u8; MEM_SIZE];
        for proc in &vm.processes {
            if proc.ir >= 0 && proc.ir <= 15 && vm.owner[proc.pc] != 0 {
                ir_map[proc.pc] = proc.owner as u8;
            }
        }

        let per_line = self.height as usize;
        let mut changed = false;

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
                changed = true;
            }
        }

        // Update panel only if relevant state changed
        let panel_changed = vm.cycles != self.last_cycles
            || vm.cycle_to_die != self.last_cycle_to_die
            || vm.nchecks != self.last_nchecks
            || vm.process_alive != self.last_process_alive
            || vm.nprocess != self.last_nprocess
            || self.speed != self.last_speed
            || self.paused != self.last_paused;

        if panel_changed || changed {
            self.draw_panel_full(vm);
            // Redraw boxes only if something changed in the arena
            if changed {
                self.draw_boxes();
            }
        }

        // Always flush to push updates to terminal
        let _ = self.stdout.flush();
        self.update_cache(vm);
    }

    /// Update the cached panel values
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
        let white = SetForegroundColor(Color::White);
        let reset = SetAttribute(Attribute::Reset);
        self.draw_box(0, 0, self.width + 2, self.height + 2);
        self.draw_box(self.width + 2, 0, self.s_width + 2, self.height - self.p_height + 2);
        self.draw_box(self.width + 2, self.proc_y, self.s_width + 2, self.p_height);
        let _ = queue!(self.stdout, white, reset);
    }

    /// Draw a simple box border around a region (matching C's box())
    fn draw_box(&mut self, x: i32, y: i32, w: i32, h: i32) {
        let white = SetForegroundColor(Color::White);
        let reset = SetAttribute(Attribute::Reset);

        let _ = queue!(
            self.stdout,
            cursor::MoveTo((x + 1) as u16, y as u16),
            white, Print("─".repeat((w - 2) as usize)), reset
        );
        let _ = queue!(
            self.stdout,
            cursor::MoveTo((x + 1) as u16, (y + h - 1) as u16),
            white, Print("─".repeat((w - 2) as usize)), reset
        );

        for row in (y + 1)..(y + h - 1) {
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(x as u16, row as u16),
                white, Print("│"), reset
            );
            let _ = queue!(
                self.stdout,
                cursor::MoveTo((x + w - 1) as u16, row as u16),
                white, Print("│"), reset
            );
        }

        let _ = queue!(self.stdout, cursor::MoveTo(x as u16, y as u16), white, Print("┌"), reset);
        let _ = queue!(self.stdout, cursor::MoveTo((x + w - 1) as u16, y as u16), white, Print("┐"), reset);
        let _ = queue!(self.stdout, cursor::MoveTo(x as u16, (y + h - 1) as u16), white, Print("└"), reset);
        let _ = queue!(self.stdout, cursor::MoveTo((x + w - 1) as u16, (y + h - 1) as u16), white, Print("┘"), reset);
    }

    /// Full arena draw — writes all 4096 cells (only for first frame)
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

    /// Full panel draw — header + players + processes
    fn draw_panel_full(&mut self, vm: &Vm) {
        self.draw_header(vm);
        self.draw_players(vm);
        self.draw_processes(vm);
    }

    /// Draw header info (cycles, speed, etc.)
    fn draw_header(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let white = SetForegroundColor(Color::White);
        let black_bg = SetBackgroundColor(Color::Black);

        // Clear header area
        for r in 1u16..=6 {
            let _ = queue!(self.stdout, cursor::MoveTo(sx, r), terminal::Clear(ClearType::CurrentLine));
        }

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
                black_bg, bold, white, Print(line), reset,
            );
        }

        let status = if self.paused { "** PAUSED **" } else { "** RUNNING **" };
        let _ = queue!(
            self.stdout,
            cursor::MoveTo(sx + 34, 1),
            black_bg, bold, white, Print(status), reset,
        );

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

        for r in 8u16..(8 + (5 * vm.nplayers as u16)) {
            let _ = queue!(self.stdout, cursor::MoveTo(sx, r), terminal::Clear(ClearType::CurrentLine));
        }

        let mut i: u16 = 8;
        for (idx, player) in vm.players.iter().enumerate() {
            let color = player_panel_color(idx);
            let fg = SetForegroundColor(color);

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i),
                black_bg, bold, white, Print(format!("PLAYER {}", player.nplayer)), reset,
            );
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i + 1),
                black_bg, fg, Print(format!("\t\t({})", player.name)), reset,
            );
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i + 2),
                black_bg, white, Print(format!("Last live: \t\t\t{}", player.last_live_cycle)), reset,
            );
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, i + 3),
                black_bg, white, Print(format!("Lives in current period: \t{}", player.nblive)), reset,
            );
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

        // Clear process area
        for r in 0..(self.p_height - 1) {
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, sy + r as u16),
                terminal::Clear(ClearType::CurrentLine),
            );
        }

        let header = format!(
            " _____________PROCESSES_({:04} / {:04})_____________",
            vm.process_alive, vm.nprocess
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
            let green_fg = SetForegroundColor(Color::Rgb { r: 0, g: 204, b: 0 });

            let proc_text = format!("{}Process {:04}  PC:", carry_marker, n);
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 1, sy + i),
                black_bg, fg, Print(&proc_text), reset,
            );

            let pc_text = format!("{:04}", proc.pc);
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 18, sy + i),
                black_bg, SetForegroundColor(Color::White), Print(&pc_text), reset,
            );

            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 23, sy + i),
                black_bg, fg, Print("OP: "), reset,
            );

            let op_name = if proc.last_ir > 0 && proc.last_ir <= 16 {
                OP_TABLE[proc.last_ir as usize - 1].name
            } else {
                "____"
            };
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx + 27, sy + i),
                black_bg, bold, green_fg, Print(op_name), reset,
            );

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
    }

    /// Display the winner screen
    pub fn show_winner(&mut self, vm: &Vm) {
        let sx = (self.width + 3) as u16;
        let sy = (self.proc_y + 1) as u16;
        let bold = SetAttribute(Attribute::Bold);
        let reset = SetAttribute(Attribute::Reset);
        let black_bg = SetBackgroundColor(Color::Black);

        for r in 0..self.p_height {
            let _ = queue!(
                self.stdout,
                cursor::MoveTo(sx, (self.proc_y + r) as u16),
                terminal::Clear(ClearType::CurrentLine),
            );
        }

        let header = format!(
            " _____________PROCESSES_(0000 / {:04})_____________",
            vm.nprocess
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
        let _ = execute!(self.stdout, cursor::Show);
        let _ = execute!(self.stdout, terminal::LeaveAlternateScreen);
        let _ = terminal::disable_raw_mode();
    }

    /// Wait for a key press (blocking)
    pub fn wait_for_key(&self) {
        let _ = event::read();
    }
}
