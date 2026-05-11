use ncurses::*;
use corewar_common::constants::*;
use corewar_common::op_table::OP_TABLE;
use super::vm::Vm;

// Speed constants (matching C version)
pub const MAX_SPEED: i32 = 0;
pub const MIN_SPEED: i32 = 30000;
pub const FINE_SPEED_STEP: i32 = 100;
pub const COARSE_SPEED_STEP: i32 = 500;

// Color pair indices (matching C version)
const CP_GRAY: i16 = 1;
const CP_CYAN: i16 = 2;
const CP_BLUE: i16 = 3;
const CP_RED: i16 = 4;
const CP_GREEN: i16 = 5;
const CP_BLACK_ON_GRAY: i16 = 6;
// Extra color for status bar
const CP_STATUS: i16 = 7;

/// Return codes from ncupdate()
pub const CTRL_CONTINUE: i32 = 0;
pub const CTRL_QUIT: i32 = 1;
pub const CTRL_PAUSED: i32 = 2;
pub const CTRL_STEP: i32 = 3; // Execute exactly one cycle then pause

/// State for the ncurses visualizer
pub struct Visualizer {
    pub speed: i32,
    pub paused: bool,
    height: i32,
    width: i32,
    s_width: i32,
    p_height: i32,
    proc_y: i32,
    m_win: WINDOW,
    s_win: WINDOW,
    p_win: WINDOW,
    b_win: WINDOW, // Bottom status bar window
    // Process scrolling
    proc_scroll: usize,
    // Step mode
    stepping: bool,
}

impl Visualizer {
    /// Initialize ncurses and create windows
    pub fn init(vm: &Vm) -> Self {
        // Initialize ncurses
        initscr();
        noecho();
        keypad(stdscr(), true);
        nodelay(stdscr(), true);
        curs_set(CURSOR_VISIBILITY::CURSOR_INVISIBLE);

        // Initialize colors (exactly matching C version)
        start_color();
        init_color(COLOR_YELLOW, 180, 180, 180);
        init_color(COLOR_CYAN, 0, 850, 850);
        init_color(COLOR_BLUE, 400, 400, 1000);
        init_color(COLOR_GREEN, 0, 800, 0);
        init_color(COLOR_RED, 900, 0, 0);
        init_color(COLOR_BLACK, 0, 0, 0);

        init_pair(CP_GRAY, COLOR_YELLOW, COLOR_BLACK);
        init_pair(CP_CYAN, COLOR_CYAN, COLOR_BLACK);
        init_pair(CP_BLUE, COLOR_BLUE, COLOR_BLACK);
        init_pair(CP_RED, COLOR_RED, COLOR_BLACK);
        init_pair(CP_GREEN, COLOR_GREEN, COLOR_BLACK);
        init_pair(CP_BLACK_ON_GRAY, COLOR_BLACK, COLOR_YELLOW);
        // Status bar: white on blue background
        init_pair(CP_STATUS, COLOR_WHITE, COLOR_BLUE);

        let sqrt = (MEM_SIZE as f64).sqrt() as i32; // 64
        let height = sqrt;
        let width = sqrt * 3;
        let s_width = 50;
        let proc_y = (5 * vm.nplayers as i32) + 10;
        let p_height = height + 2 - proc_y;

        // Create windows
        let m_win = newwin(height + 2, width + 2, 0, 0);
        let s_win = newwin(height - p_height + 2, s_width + 2, 0, width + 2);
        let p_win = newwin(p_height, s_width + 2, proc_y, width + 2);
        // Status bar: 1 row at the bottom spanning the full width
        let total_width = width + 2 + s_width + 2;
        let b_win = newwin(1, total_width, height + 2, 0);

        let vis = Visualizer {
            speed: 3000,
            paused: false,
            height,
            width,
            s_width,
            p_height,
            proc_y,
            m_win,
            s_win,
            p_win,
            b_win,
            proc_scroll: 0,
            stepping: false,
        };

        // Initial full draw
        vis.full_redraw(vm);
        vis
    }

    /// Handle user input
    /// Returns: CTRL_CONTINUE, CTRL_QUIT, CTRL_PAUSED, CTRL_STEP
    pub fn ncupdate(&mut self, vm: &Vm) -> i32 {
        let input = getch();

        if input == 'q' as i32 {
            return CTRL_QUIT;
        }

        // Toggle pause with space
        if input == ' ' as i32 {
            nodelay(stdscr(), self.paused);
            self.paused = !self.paused;
            self.stepping = false; // Cancel stepping when toggling pause
        }

        // Step mode: press 's' to advance exactly one cycle
        if input == 's' as i32 {
            if !self.stepping {
                self.stepping = true;
                self.paused = false;
                nodelay(stdscr(), true);
            }
        }

        if input == KEY_RESIZE {
            self.recreate_windows();
        }

        // Process scrolling (works even when paused)
        if input == KEY_PPAGE {
            // Page Up — scroll processes up
            if self.proc_scroll > 0 {
                self.proc_scroll = self.proc_scroll.saturating_sub(5);
                self.full_redraw(vm);
            }
        }
        if input == KEY_NPAGE {
            // Page Down — scroll processes down
            let max_scroll = vm.processes.len().saturating_sub(self.visible_proc_lines() as usize);
            if self.proc_scroll < max_scroll {
                self.proc_scroll = (self.proc_scroll + 5).min(max_scroll);
                self.full_redraw(vm);
            }
        }

        if self.paused && !self.stepping {
            // Redraw after space/resize when paused
            if input == ' ' as i32 || input == KEY_RESIZE {
                self.full_redraw(vm);
            }
            return CTRL_PAUSED;
        }

        // Coarse speed controls (arrow keys: step of 500)
        if input == KEY_UP && self.speed > MAX_SPEED {
            self.speed = (self.speed - COARSE_SPEED_STEP).max(MAX_SPEED);
        }
        if input == KEY_DOWN && self.speed < MIN_SPEED {
            self.speed = (self.speed + COARSE_SPEED_STEP).min(MIN_SPEED);
        }

        // Fine speed controls (+/- keys: step of 100)
        if (input == '+' as i32 || input == '=' as i32) && self.speed > MAX_SPEED {
            self.speed = (self.speed - FINE_SPEED_STEP).max(MAX_SPEED);
        }
        if (input == '-' as i32) && self.speed < MIN_SPEED {
            self.speed = (self.speed + FINE_SPEED_STEP).min(MIN_SPEED);
        }

        // Full redraw every frame
        self.full_redraw(vm);

        // Sleep for frame timing
        if input != KEY_RESIZE {
            std::thread::sleep(std::time::Duration::from_micros(self.speed as u64));
        }

        // If stepping, return STEP so the caller executes one cycle then we'll pause
        if self.stepping {
            self.stepping = false;
            self.paused = true;
            nodelay(stdscr(), self.paused);
            return CTRL_STEP;
        }

        CTRL_CONTINUE
    }

    /// Recalculate and recreate all windows (only called on terminal resize)
    fn recreate_windows(&mut self) {
        refresh();
        delwin(self.m_win);
        delwin(self.s_win);
        delwin(self.p_win);
        delwin(self.b_win);
        self.m_win = newwin(self.height + 2, self.width + 2, 0, 0);
        self.s_win = newwin(self.height - self.p_height + 2, self.s_width + 2, 0, self.width + 2);
        self.p_win = newwin(self.p_height, self.s_width + 2, self.proc_y, self.width + 2);
        let total_width = self.width + 2 + self.s_width + 2;
        self.b_win = newwin(1, total_width, self.height + 2, 0);
    }

    /// How many lines are available for displaying processes
    fn visible_proc_lines(&self) -> i32 {
        // p_height - 2 = total interior lines, minus 1 for the header line
        (self.p_height - 2).max(1)
    }

    /// Full redraw — erase, draw content, then atomic doupdate()
    fn full_redraw(&self, vm: &Vm) {
        // Erase all windows
        werase(self.m_win);
        werase(self.s_win);
        werase(self.p_win);
        werase(self.b_win);

        // Draw content into each window
        self.fill_arena(vm);
        self.print_panel(vm);
        self.print_status_bar(vm);

        // Draw boxes
        box_(self.m_win, 0, 0);
        box_(self.s_win, 0, 0);
        box_(self.p_win, 0, 0);

        // Stage all window updates without flushing
        wnoutrefresh(self.m_win);
        wnoutrefresh(self.s_win);
        wnoutrefresh(self.p_win);
        wnoutrefresh(self.b_win);

        // Single atomic screen update — this is the key to flicker-free rendering
        doupdate();
    }

    /// Fill the arena window with colored memory cells — mirrors C's fill_arena()
    fn fill_arena(&self, vm: &Vm) {
        let mut row: i32 = 1;
        let mut col: i32 = 1;
        let per_line = self.height;

        for i in 0..MEM_SIZE {
            let owner = vm.owner[i];
            let is_pc = vm.processes.iter().any(|p| p.pc == i);
            let ow = if owner != 0 { is_ir(&vm.processes, i) } else { 0 };

            // Color pair — exactly matching C logic
            let color: i16 = if owner == 0 && is_pc {
                CP_BLACK_ON_GRAY
            } else {
                owner as i16 + 1
            };

            // Bold if recently written (scrb)
            if vm.scrb[i] != 0 {
                wattron(self.m_win, A_BOLD());
            }

            // Standout if process with active IR at this position
            if owner != 0 && ow != 0 {
                wattron(self.m_win, A_STANDOUT() | COLOR_PAIR((ow + 1) as i16));
            }

            wattron(self.m_win, COLOR_PAIR(color));
            mvwprintw(self.m_win, row, col, &format!("{:02x} ", vm.arena[i]));
            wattroff(self.m_win, COLOR_PAIR(color));

            if vm.scrb[i] != 0 {
                wattroff(self.m_win, A_BOLD());
            }
            if owner != 0 && ow != 0 {
                wattroff(self.m_win, A_STANDOUT() | COLOR_PAIR((ow + 1) as i16));
            }

            col += 3;
            if i != 1 && (i + 1) as i32 % per_line == 0 {
                row += 1;
                col = 1;
            }
        }
    }

    /// Print the side panel
    fn print_panel(&self, vm: &Vm) {
        self.print_header(vm);
        self.print_players(vm);
        self.print_processes(vm);
    }

    /// Print header info
    fn print_header(&self, vm: &Vm) {
        wattron(self.s_win, A_BOLD());
        mvwprintw(self.s_win, 1, 1, &format!("CYCLES\t\t{}", vm.cycles));
        if self.stepping {
            mvwprintw(self.s_win, 1, 35, "** STEPPING **");
        } else if self.paused {
            mvwprintw(self.s_win, 1, 35, "** PAUSED **");
        } else {
            mvwprintw(self.s_win, 1, 35, "** RUNNING **");
        }
        mvwprintw(self.s_win, 2, 1, &format!("CYCLE_TO_DIE\t{}", vm.cycle_to_die));
        mvwprintw(self.s_win, 2, 35, &format!("Speed: {}", 50000 - self.speed));
        mvwprintw(self.s_win, 3, 1, &format!("CYCLE_DELTA\t{}", CYCLE_DELTA));
        mvwprintw(self.s_win, 4, 1, &format!("MAX CHECKS\t{}", MAX_CHECKS));
        mvwprintw(self.s_win, 5, 1, &format!("CHECK\t\t{}", vm.nchecks));
        mvwprintw(self.s_win, 6, 1, "__________________________________________________");
        wattroff(self.s_win, A_BOLD());
    }

    /// Print player info
    fn print_players(&self, vm: &Vm) {
        let mut i: i32 = 8;
        for (idx, player) in vm.players.iter().enumerate() {
            let player_color: i16 = (idx as i16) + 2;

            wattron(self.s_win, A_BOLD());
            mvwprintw(self.s_win, i, 1, &format!("PLAYER {}", player.nplayer));
            wattroff(self.s_win, A_BOLD());

            wattron(self.s_win, COLOR_PAIR(player_color));
            mvwprintw(self.s_win, i + 1, 1, &format!("\t\t({})", player.name));
            wattroff(self.s_win, COLOR_PAIR(player_color));

            mvwprintw(self.s_win, i + 2, 1, &format!("Last live: \t\t\t{}", player.last_live_cycle));
            mvwprintw(self.s_win, i + 3, 1, &format!("Lives in current period: \t{}", player.nblive));
            i += 5;
        }
    }

    /// Print processes with scroll support
    fn print_processes(&self, vm: &Vm) {
        let total_procs = vm.processes.len();
        let visible_lines = self.visible_proc_lines();

        // Clamp scroll offset
        let max_scroll = total_procs.saturating_sub(visible_lines as usize);
        let scroll = self.proc_scroll.min(max_scroll);

        let mut n = vm.process_alive - scroll as i32;

        // Header with scroll indicator
        wattron(self.p_win, A_BOLD());
        let scroll_info = if total_procs > visible_lines as usize {
            let page = scroll / (visible_lines as usize).max(1) + 1;
            let total_pages = (total_procs + (visible_lines as usize).max(1) - 1) / (visible_lines as usize).max(1);
            format!(" Pg{}/{}", page, total_pages)
        } else {
            String::new()
        };
        mvwprintw(
            self.p_win, 1, 0,
            &format!(
                " _____________PROCESSES_({:04} / {:04}){}_____________",
                vm.process_alive, vm.nprocess, scroll_info
            ),
        );
        wattroff(self.p_win, A_BOLD());

        let mut i: i32 = 2;
        for proc in vm.processes.iter().skip(scroll) {
            if i >= self.p_height - 1 {
                break;
            }
            let carry_marker = if proc.carry != 0 { "*" } else { " " };
            let owner_color: i16 = proc.owner as i16 + 1;

            wattron(self.p_win, COLOR_PAIR(owner_color));
            mvwprintw(
                self.p_win, i, 1,
                &format!("{}Process {:04}  PC:", carry_marker, n),
            );
            wattroff(self.p_win, COLOR_PAIR(owner_color));

            mvwprintw(self.p_win, i, 19, &format!("{:04}", proc.pc));

            wattron(self.p_win, COLOR_PAIR(owner_color));
            mvwprintw(self.p_win, i, 24, "OP: ");
            wattroff(self.p_win, COLOR_PAIR(owner_color));

            wattron(self.p_win, COLOR_PAIR(CP_GREEN) | A_BOLD());
            let op_name = if proc.last_ir > 0 && proc.last_ir <= 16 {
                OP_TABLE[proc.last_ir as usize - 1].name
            } else {
                "____"
            };
            mvwprintw(self.p_win, i, 28, op_name);
            wattroff(self.p_win, COLOR_PAIR(CP_GREEN) | A_BOLD());

            // Print registers
            self.print_registers(i, &proc.reg);

            i += 1;
            n -= 1;
        }

        // Show scroll hint at bottom if there are more processes
        if total_procs > visible_lines as usize {
            wattron(self.p_win, COLOR_PAIR(CP_GRAY) | A_BOLD());
            let remaining = total_procs.saturating_sub(scroll + visible_lines as usize);
            mvwprintw(
                self.p_win,
                self.p_height - 1,
                2,
                &format!("... {} more (PgUp/PgDn)", remaining),
            );
            wattroff(self.p_win, COLOR_PAIR(CP_GRAY) | A_BOLD());
        }
    }

    /// Print register state
    fn print_registers(&self, i: i32, reg: &[i32; REG_NUMBER]) {
        for x in 0..REG_NUMBER {
            if reg[x] != 0 {
                wattron(self.p_win, COLOR_PAIR(CP_GREEN) | A_BOLD());
                mvwprintw(self.p_win, i + 1, (34 + x) as i32, "x");
                wattroff(self.p_win, COLOR_PAIR(CP_GREEN) | A_BOLD());
            } else {
                wattron(self.p_win, COLOR_PAIR(CP_RED) | A_BOLD());
                mvwprintw(self.p_win, i + 1, (34 + x) as i32, ".");
                wattroff(self.p_win, COLOR_PAIR(CP_RED) | A_BOLD());
            }
        }
    }

    /// Print the status bar at the bottom of the screen
    fn print_status_bar(&self, vm: &Vm) {
        // Left section: controls
        wattron(self.b_win, COLOR_PAIR(CP_STATUS) | A_BOLD());
        let controls = " q:Quit  Space:Pause  s:Step  Up/Dn:Speed  +/-:FineSpeed  PgUp/PgDn:Scroll ";
        mvwprintw(self.b_win, 0, 0, controls);
        wattroff(self.b_win, COLOR_PAIR(CP_STATUS) | A_BOLD());

        // Right section: color legend for each player
        let mut col = controls.len() as i32 + 2;
        let total_width = self.width + 2 + self.s_width + 2;
        for (idx, player) in vm.players.iter().enumerate() {
            if col + 12 > total_width {
                break;
            }
            let player_color: i16 = (idx as i16) + 2;
            wattron(self.b_win, COLOR_PAIR(player_color) | A_BOLD());
            // Show a colored block with player number
            mvwprintw(self.b_win, 0, col, &format!(" P{}", (-player.nplayer)));
            wattroff(self.b_win, COLOR_PAIR(player_color) | A_BOLD());
            col += 12;
        }

        // Fill the rest of the bar with the status color
        wattron(self.b_win, COLOR_PAIR(CP_STATUS));
        while col < total_width {
            mvwprintw(self.b_win, 0, col, " ");
            col += 1;
        }
        wattroff(self.b_win, COLOR_PAIR(CP_STATUS));
    }

    /// Display the winner screen
    pub fn show_winner(&mut self, vm: &Vm) {
        // Recreate the process window for the winner display
        delwin(self.p_win);
        self.p_win = newwin(self.p_height, self.s_width + 2, self.proc_y, self.width + 2);

        werase(self.p_win);

        wattron(self.p_win, A_BOLD());
        mvwprintw(
            self.p_win, 1, 0,
            &format!(
                " _____________PROCESSES_(0000 / {:04})_____________",
                vm.nprocess
            ),
        );
        wattroff(self.p_win, A_BOLD());

        for (idx, player) in vm.players.iter().enumerate() {
            if player.nplayer == vm.last_alive {
                let color: i16 = (idx as i16) + 2;
                let mid = self.p_height / 2;

                wattron(self.p_win, COLOR_PAIR(color));
                mvwprintw(self.p_win, mid - 3, 2, "WINNER!");
                mvwprintw(self.p_win, mid - 1, 5, &format!("PLAYER: {}", vm.last_alive));
                mvwprintw(self.p_win, mid, 5, &player.name);
                wattroff(self.p_win, COLOR_PAIR(color));
                break;
            }
        }

        box_(self.p_win, 0, 0);
        wnoutrefresh(self.p_win);
        doupdate();
    }

    /// Clean up ncurses
    pub fn end(&self) {
        delwin(self.b_win);
        endwin();
    }

    /// Switch stdscr to blocking input (for "press any key" after winner)
    pub fn set_blocking_input(&self) {
        nodelay(stdscr(), false);
    }

    /// Wait for a key press
    pub fn wait_for_key(&self) {
        getch();
    }
}

/// Check if a process at position i has an active IR — mirrors C's is_ir()
fn is_ir(processes: &[super::vm::Process], i: usize) -> i32 {
    for proc in processes {
        if proc.pc == i && proc.ir >= 0 && proc.ir <= 15 {
            return proc.owner;
        }
    }
    0
}
