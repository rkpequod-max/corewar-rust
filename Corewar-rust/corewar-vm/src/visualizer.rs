use ncurses::*;
use corewar_common::constants::*;
use corewar_common::op_table::OP_TABLE;
use super::vm::Vm;

// Speed constants (matching C version)
pub const MAX_SPEED: i32 = 0;
pub const MIN_SPEED: i32 = 30000;

// Color pair indices (matching C version)
const CP_GRAY: i16 = 1;
const CP_CYAN: i16 = 2;
const CP_BLUE: i16 = 3;
const CP_RED: i16 = 4;
const CP_GREEN: i16 = 5;
const CP_BLACK_ON_GRAY: i16 = 6;

/// State for the ncurses visualizer — mirrors the C version exactly
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
}

impl Visualizer {
    /// Initialize ncurses and create windows — mirrors C's print_arena()
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

        let sqrt = (MEM_SIZE as f64).sqrt() as i32; // 64
        let height = sqrt;
        let width = sqrt * 3;
        let s_width = 50;
        let proc_y = (5 * vm.nplayers as i32) + 10;
        let p_height = height + 2 - proc_y;

        // Create windows (exactly like C's resize_window)
        let m_win = newwin(height + 2, width + 2, 0, 0);
        let s_win = newwin(height - p_height + 2, s_width + 2, 0, width + 2);
        let p_win = newwin(p_height, s_width + 2, proc_y, width + 2);

        let mut vis = Visualizer {
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
        };

        vis.refresh_all(vm);
        vis
    }

    /// Handle user input — mirrors C's ncupdate()
    /// Returns: 0=continue, 1=quit, 2=paused
    pub fn ncupdate(&mut self, vm: &Vm) -> i32 {
        let input = getch();

        if input == 'q' as i32 {
            return 1;
        }
        if input == ' ' as i32 {
            nodelay(stdscr(), self.paused);
            self.paused = !self.paused;
        }
        if input == KEY_RESIZE || input == ' ' as i32 {
            self.resize_window(vm);
        }
        if self.paused {
            return 2;
        } else {
            self.resize_window(vm);
        }
        if input == KEY_UP && self.speed > MAX_SPEED {
            self.speed -= 500;
        }
        if input == KEY_DOWN && self.speed < MIN_SPEED {
            self.speed += 500;
        }
        if input != KEY_RESIZE {
            unsafe {
                libc::usleep(self.speed as u32);
            }
        }

        0
    }

    /// Resize/recreate windows and redraw — mirrors C's resize_window()
    fn resize_window(&mut self, vm: &Vm) {
        refresh();
        delwin(self.m_win);
        delwin(self.s_win);
        delwin(self.p_win);
        self.m_win = newwin(self.height + 2, self.width + 2, 0, 0);
        self.s_win = newwin(self.height - self.p_height + 2, self.s_width + 2, 0, self.width + 2);
        self.p_win = newwin(self.p_height, self.s_width + 2, self.proc_y, self.width + 2);

        self.fill_arena(vm);
        self.print_panel(vm);
        box_(self.m_win, 0, 0);
        box_(self.s_win, 0, 0);
        box_(self.p_win, 0, 0);
        wrefresh(self.m_win);
        wrefresh(self.s_win);
        wrefresh(self.p_win);
    }

    /// Redraw all windows
    pub fn refresh_all(&mut self, vm: &Vm) {
        self.resize_window(vm);
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
                wattron(self.m_win, A_STANDOUT() | COLOR_PAIR(ow + 1));
            }

            wattron(self.m_win, COLOR_PAIR(color));
            mvwprintw(self.m_win, row, col, &format!("{:02x} ", vm.arena[i]));
            wattroff(self.m_win, COLOR_PAIR(color));

            if vm.scrb[i] != 0 {
                wattroff(self.m_win, A_BOLD());
            }
            if owner != 0 && ow != 0 {
                wattroff(self.m_win, A_STANDOUT() | COLOR_PAIR(ow + 1));
            }

            col += 3;
            if i != 1 && (i + 1) as i32 % per_line == 0 {
                row += 1;
                col = 1;
            }
        }
    }

    /// Print the side panel — mirrors C's print_panel()
    fn print_panel(&self, vm: &Vm) {
        self.print_header(vm);
        self.print_players(vm);
        self.print_processes(vm);
    }

    /// Print header info — mirrors C's print_header()
    fn print_header(&self, vm: &Vm) {
        wattron(self.s_win, A_BOLD());
        mvwprintw(self.s_win, 1, 1, &format!("CYCLES\t\t{}", vm.cycles));
        mvwprintw(self.s_win, 1, 35, if self.paused { "** PAUSED **" } else { "** RUNNING **" });
        mvwprintw(self.s_win, 2, 1, &format!("CYCLE_TO_DIE\t{}", vm.cycle_to_die));
        mvwprintw(self.s_win, 2, 35, &format!("Speed: {}", 50000 - self.speed));
        mvwprintw(self.s_win, 3, 1, &format!("CYCLE_DELTA\t{}", CYCLE_DELTA));
        mvwprintw(self.s_win, 4, 1, &format!("MAX CHECKS\t{}", MAX_CHECKS));
        mvwprintw(self.s_win, 5, 1, &format!("CHECK\t\t{}", vm.nchecks));
        mvwprintw(self.s_win, 6, 1, "__________________________________________________");
        wattroff(self.s_win, A_BOLD());
    }

    /// Print player info — mirrors C's print_panel() player section
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

    /// Print processes — mirrors C's print_processes()
    fn print_processes(&self, vm: &Vm) {
        let mut n = vm.process_alive;

        wattron(self.p_win, A_BOLD());
        mvwprintw(
            self.p_win, 1, 0,
            &format!(
                " _____________PROCESSES_({:04} / {:04})_____________",
                vm.process_alive, vm.nprocess
            ),
        );
        wattroff(self.p_win, A_BOLD());

        let mut i: i32 = 2;
        for proc in &vm.processes {
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
    }

    /// Print register state — mirrors C's print_registers()
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

    /// Display the winner screen — mirrors C's champion_won()
    pub fn show_winner(&mut self, vm: &Vm) {
        refresh();
        delwin(self.p_win);
        self.p_win = newwin(self.p_height, self.s_width + 2, self.proc_y, self.width + 2);

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
        wrefresh(self.p_win);
    }

    /// Clean up ncurses — mirrors C's endwin()
    pub fn end(&self) {
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
