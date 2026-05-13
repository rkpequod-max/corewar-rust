use wasm_bindgen::prelude::*;
use corewar_vm::{Vm, VmEvent, Player};
use corewar_common::constants::*;

/// WASM bridge for the Corewar VM.
/// This wraps the real Rust VM for use in the browser.
/// All VM logic is the EXACT SAME code as the CLI binary — zero reimplementation.

#[wasm_bindgen]
pub struct WasmVm {
    vm: Vm,
}

#[wasm_bindgen]
impl WasmVm {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        WasmVm { vm: Vm::new() }
    }

    /// Load a champion from raw .cor file bytes
    pub fn load_player_bytes(&mut self, data: &[u8], name: &str) -> Result<(), JsValue> {
        self.vm
            .load_player_bytes(data, name, None)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Load a champion with a specific player number
    pub fn load_player_bytes_with_num(&mut self, data: &[u8], name: &str, nplayer: i32) -> Result<(), JsValue> {
        self.vm
            .load_player_bytes(data, name, Some(nplayer))
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Place champions in arena and create initial processes
    pub fn init(&mut self) {
        self.vm.load_champions();
        self.vm.load_processes();
    }

    /// Execute a single cycle. Returns false when the VM has finished.
    pub fn step(&mut self) -> bool {
        self.vm.step()
    }

    /// Execute N cycles. Returns false when the VM has finished.
    pub fn step_n(&mut self, n: usize) -> bool {
        for _ in 0..n {
            if !self.vm.step() {
                return false;
            }
        }
        true
    }

    /// Reset the VM (keeps loaded players)
    pub fn reset(&mut self) {
        let players: Vec<(String, String, Vec<u8>)> = self.vm.players.iter()
            .map(|p| (p.name.clone(), p.comment.clone(), p.code.clone()))
            .collect();

        self.vm = Vm::new();

        for (name, comment, code) in players {
            let nplayer = -(self.vm.nplayers as i32) - 1;
            let player = Player {
                nplayer,
                name,
                comment,
                code,
                prog_size: 0, // will be set by load
                pc_address: 0,
                nblive: 0,
                last_live_cycle: 0,
            };
            // Recalculate prog_size
            let mut player = player;
            player.prog_size = player.code.len();
            self.vm.players.push(player);
            self.vm.nplayers += 1;
        }

        if self.vm.nplayers > 0 {
            self.vm.load_champions();
            self.vm.load_processes();
        }
    }

    // ── Arena access ──

    /// Get a copy of the arena memory (4096 bytes)
    pub fn get_arena(&self) -> Vec<u8> {
        self.vm.arena.to_vec()
    }

    /// Get a copy of the owner map (4096 bytes, 0=none, 1-4=player)
    pub fn get_owner(&self) -> Vec<u8> {
        self.vm.owner.to_vec()
    }

    /// Get a copy of the scrb (screen buffer) map (4096 bytes)
    pub fn get_scrb(&self) -> Vec<u8> {
        self.vm.scrb.to_vec()
    }

    /// Read a single byte from arena
    pub fn arena_byte(&self, addr: usize) -> u8 {
        self.vm.arena[addr % MEM_SIZE]
    }

    /// Read owner of a single byte
    pub fn owner_byte(&self, addr: usize) -> u8 {
        self.vm.owner[addr % MEM_SIZE]
    }

    // ── VM state ──

    pub fn cycles(&self) -> i32 {
        self.vm.cycles
    }

    pub fn cycle_to_die(&self) -> i32 {
        self.vm.cycle_to_die
    }

    pub fn nchecks(&self) -> i32 {
        self.vm.nchecks
    }

    pub fn nlives(&self) -> i32 {
        self.vm.nlives
    }

    pub fn process_count(&self) -> usize {
        self.vm.processes.len()
    }

    pub fn player_count(&self) -> usize {
        self.vm.nplayers
    }

    pub fn is_running(&self) -> bool {
        !self.vm.processes.is_empty() && self.vm.cycle_to_die > 0
    }

    // ── Player info ──

    pub fn player_name(&self, idx: usize) -> String {
        self.vm.players.get(idx).map(|p| p.name.clone()).unwrap_or_default()
    }

    pub fn player_nplayer(&self, idx: usize) -> i32 {
        self.vm.players.get(idx).map(|p| p.nplayer).unwrap_or(0)
    }

    pub fn player_last_live(&self, idx: usize) -> i32 {
        self.vm.players.get(idx).map(|p| p.last_live_cycle).unwrap_or(0)
    }

    pub fn player_lives(&self, idx: usize) -> i32 {
        self.vm.players.get(idx).map(|p| p.nblive).unwrap_or(0)
    }

    pub fn player_code_size(&self, idx: usize) -> usize {
        self.vm.players.get(idx).map(|p| p.code.len()).unwrap_or(0)
    }

    pub fn player_pc_address(&self, idx: usize) -> usize {
        self.vm.players.get(idx).map(|p| p.pc_address).unwrap_or(0)
    }

    // ── Process info ──

    pub fn process_pc(&self, idx: usize) -> usize {
        self.vm.processes.get(idx).map(|p| p.pc).unwrap_or(0)
    }

    pub fn process_owner(&self, idx: usize) -> i32 {
        self.vm.processes.get(idx).map(|p| p.owner).unwrap_or(0)
    }

    pub fn process_carry(&self, idx: usize) -> i32 {
        self.vm.processes.get(idx).map(|p| p.carry).unwrap_or(0)
    }

    pub fn process_ir(&self, idx: usize) -> i32 {
        self.vm.processes.get(idx).map(|p| p.ir).unwrap_or(-1)
    }

    pub fn process_duration(&self, idx: usize) -> i32 {
        self.vm.processes.get(idx).map(|p| p.duration).unwrap_or(0)
    }

    /// Get the opcode name for a process's current instruction
    pub fn process_op_name(&self, idx: usize) -> String {
        if let Some(proc) = self.vm.processes.get(idx) {
            if proc.ir >= 0 && proc.ir < 16 {
                return corewar_common::op_table::OP_TABLE[proc.ir as usize].name.to_string();
            }
        }
        "---".to_string()
    }

    // ── Events ──

    /// Drain and return events as a JSON string (for JS parsing)
    pub fn drain_events_json(&mut self) -> String {
        let events: Vec<String> = self.vm.drain_events().iter().map(|e| {
            match e {
                VmEvent::PlayerAlive { nplayer, name, cycle } => {
                    format!(r#"{{"type":"alive","nplayer":{},"name":"{}","cycle":{}}}"#, nplayer, name, cycle)
                }
                VmEvent::AffChar { ch } => {
                    format!(r#"{{"type":"aff","ch":"{}"}}"#, ch)
                }
                VmEvent::Winner { nplayer, name } => {
                    format!(r#"{{"type":"winner","nplayer":{},"name":"{}"}}"#, nplayer, name)
                }
            }
        }).collect();
        format!("[{}]", events.join(","))
    }

    // ── Winner ──

    pub fn winner_nplayer(&self) -> i32 {
        self.vm.winner_nplayer().unwrap_or(0)
    }

    pub fn winner_name(&self) -> String {
        self.vm.winner_name().unwrap_or_default()
    }

    // ── Verbose ──

    pub fn set_verbose(&mut self, v: bool) {
        self.vm.verbose = v;
    }
}

// ── Constants exposed to JS ──

#[wasm_bindgen]
pub fn mem_size() -> usize { MEM_SIZE }

#[wasm_bindgen]
pub fn cycle_to_die_init() -> i32 { CYCLE_TO_DIE }

#[wasm_bindgen]
pub fn cycle_delta() -> i32 { CYCLE_DELTA }

#[wasm_bindgen]
pub fn nbr_live() -> i32 { NBR_LIVE }

#[wasm_bindgen]
pub fn max_checks() -> i32 { MAX_CHECKS }

#[wasm_bindgen]
pub fn reg_number() -> usize { REG_NUMBER }

/// Get the opcode name for a given opcode number (1-16)
#[wasm_bindgen]
pub fn op_name(opcode: usize) -> String {
    if opcode >= 1 && opcode <= 16 {
        corewar_common::op_table::OP_TABLE[opcode - 1].name.to_string()
    } else {
        "???".to_string()
    }
}

/// Get the opcode cycle count for a given opcode (1-16)
#[wasm_bindgen]
pub fn op_cycle(opcode: usize) -> u32 {
    if opcode >= 1 && opcode <= 16 {
        corewar_common::op_table::OP_TABLE[opcode - 1].cycle
    } else {
        0
    }
}

// ═══════════════════════════════════════════════════════════════
// WASM Arena Renderer — pixel-perfect rendering in Rust
// ═══════════════════════════════════════════════════════════════
//
// Renders the 64×64 arena grid to an RGBA pixel buffer using the
// SAME color logic as the ncurses visualizer (visualizer.rs).
// JS blits the buffer to a Canvas via putImageData() — zero gaps,
// zero subpixel issues, pixel-perfect at any zoom level.
//
// This is the "WASM visualizer" approach: the rendering logic runs
// in Rust (matching ncurses exactly), while the display is handled
// by the browser's Canvas API.

use std::cmp;

// ── RGBA colors matching ncurses visualizer ──
// ncurses init_color uses 0-1000 scale; we pre-convert to 0-255.

const BG: [u8; 4]           = [10, 10, 10, 255];    // #0A0A0A gap/background
const BLACK: [u8; 4]        = [0, 0, 0, 255];
const WHITE: [u8; 4]        = [255, 255, 255, 255];
const GRAY: [u8; 4]         = [180, 180, 180, 255];  // #B4B4B4 (ncurses COLOR_YELLOW 180/1000)
const GRAY_BOLD: [u8; 4]    = [224, 224, 224, 255];  // #E0E0E0 bright gray
const CYAN: [u8; 4]         = [0, 217, 217, 255];    // #00D9D9 (ncurses 0,850,850)
const CYAN_BOLD: [u8; 4]    = [85, 255, 255, 255];   // #55FFFF
const BLUE: [u8; 4]         = [102, 102, 255, 255];  // #6666FF (ncurses 400,400,1000)
const BLUE_BOLD: [u8; 4]    = [153, 153, 255, 255];  // #9999FF
const RED: [u8; 4]          = [230, 0, 0, 255];      // #E60000 (ncurses 900,0,0)
const RED_BOLD: [u8; 4]     = [255, 68, 68, 255];    // #FF4444
const GREEN: [u8; 4]        = [0, 204, 0, 255];      // #00CC00 (ncurses 0,800,0)
const GREEN_BOLD: [u8; 4]   = [68, 255, 68, 255];    // #44FF44
const CYAN_DIM: [u8; 4]     = [0, 119, 119, 255];    // #007777
const BLUE_DIM: [u8; 4]     = [56, 56, 170, 255];    // #3838AA
const RED_DIM: [u8; 4]      = [153, 34, 34, 255];    // #992222
const GREEN_DIM: [u8; 4]    = [0, 119, 0, 255];      // #007700
const DARK_GRAY: [u8; 4]    = [37, 37, 37, 255];     // #252525 non-zero unowned
const NEAR_BLACK: [u8; 4]   = [14, 14, 14, 255];     // #0E0E0E zero unowned

fn player_color(idx: usize) -> [u8; 4] {
    match idx {
        0 => CYAN,
        1 => BLUE,
        2 => RED,
        3 => GREEN,
        _ => GRAY,
    }
}

fn player_bold_color(idx: usize) -> [u8; 4] {
    match idx {
        0 => CYAN_BOLD,
        1 => BLUE_BOLD,
        2 => RED_BOLD,
        3 => GREEN_BOLD,
        _ => GRAY_BOLD,
    }
}

fn player_dim_color(idx: usize) -> [u8; 4] {
    match idx {
        0 => CYAN_DIM,
        1 => BLUE_DIM,
        2 => RED_DIM,
        3 => GREEN_DIM,
        _ => GRAY,
    }
}

/// Fill a rectangle in an RGBA pixel buffer.
/// Coordinates are in pixels. No bounds checking for performance.
fn fill_rect(buf: &mut [u8], buf_w: usize, x: usize, y: usize, w: usize, h: usize, color: [u8; 4]) {
    for row in y..y + h {
        let offset = (row * buf_w + x) * 4;
        let end = offset + w * 4;
        if end > buf.len() { return; }
        let mut px = offset;
        while px < end {
            buf[px]     = color[0];
            buf[px + 1] = color[1];
            buf[px + 2] = color[2];
            buf[px + 3] = color[3];
            px += 4;
        }
    }
}

/// WASM Arena Renderer — renders the 64×64 arena to an RGBA pixel buffer.
///
/// Uses the SAME color logic as the ncurses visualizer (visualizer.rs):
/// - Owned cells: player color on black background
/// - Bold (scrb): brighter player color
/// - IR (executing instruction): inverted (player color as background)
/// - PC on unowned: gray background, black dot
/// - PC on owned: white dot in center
/// - Unowned non-zero: dark gray
/// - Unowned zero: near-black
///
/// JS retrieves the pixel buffer and blits it to a Canvas via putImageData().
#[wasm_bindgen]
pub struct WasmRenderer {
    cell_size: usize,
    gap: usize,
    img_w: usize,
    img_h: usize,
    buffer: Vec<u8>,
}

#[wasm_bindgen]
impl WasmRenderer {
    /// Create a new renderer with the given cell size and gap (in pixels).
    /// cell_size: pixels per cell side (e.g., 10)
    /// gap: pixels between cells (e.g., 1)
    #[wasm_bindgen(constructor)]
    pub fn new(cell_size: usize, gap: usize) -> Self {
        let cell_size = cmp::max(4, cell_size);
        let gap = cmp::min(gap, cell_size - 1);
        let img_w = 64 * cell_size;
        let img_h = 64 * cell_size;
        let buffer = vec![0u8; img_w * img_h * 4];
        WasmRenderer { cell_size, gap, img_w, img_h, buffer }
    }

    /// Reconfigure cell size and gap (reallocates buffer if needed).
    pub fn configure(&mut self, cell_size: usize, gap: usize) {
        let cell_size = cmp::max(4, cell_size);
        let gap = cmp::min(gap, cell_size - 1);
        if cell_size == self.cell_size && gap == self.gap {
            return;
        }
        self.cell_size = cell_size;
        self.gap = gap;
        self.img_w = 64 * cell_size;
        self.img_h = 64 * cell_size;
        self.buffer.resize(self.img_w * self.img_h * 4, 0);
    }

    /// Render the arena from the VM state into the internal pixel buffer.
    /// Accesses the VM internals directly — same code path as ncurses visualizer.
    pub fn render(&mut self, vm: &WasmVm) {
        let cs = self.cell_size;
        let gap = self.gap;
        let inner = cs - gap;
        let w = self.img_w;

        // Fill entire buffer with background (gap color)
        for chunk in self.buffer.chunks_exact_mut(4) {
            chunk.copy_from_slice(&BG);
        }

        // ── Build PC/IR maps (same logic as ncurses visualizer fill_arena) ──
        // pc_owner[i] = player index (1-4) if a process has PC at address i, else 0
        // ir_flag[i] = true if a process with active IR is at address i
        let mut pc_owner: [u8; MEM_SIZE] = [0; MEM_SIZE];
        let mut ir_flag: [bool; MEM_SIZE] = [false; MEM_SIZE];

        for proc in &vm.vm.processes {
            let pc = proc.pc;
            if pc >= MEM_SIZE { continue; }
            // Map nplayer to player index (1-4) — same as JS _procOwnerIdx
            let pidx = vm.vm.players.iter()
                .position(|p| p.nplayer == proc.owner)
                .map(|i| (i + 1) as u8)
                .unwrap_or(0);
            if pidx > 0 {
                pc_owner[pc] = pidx;
            }
            // IR flag: process is executing an instruction at this PC
            if proc.ir >= 0 && proc.ir <= 15 {
                ir_flag[pc] = true;
            }
        }

        // ── Render each cell ──
        // Color logic mirrors ncurses visualizer.rs fill_arena() exactly:
        //   owner == 0 && is_pc → CP_BLACK_ON_GRAY (gray bg)
        //   owner != 0          → CP_CYAN/BLUE/RED/GREEN on black
        //   scrb != 0           → A_BOLD (bright variant)
        //   is_ir && owner != 0 → A_STANDOUT (inverted: player color bg)
        for i in 0..MEM_SIZE {
            let col = i % 64;
            let row = i / 64;
            let px = col * cs;
            let py = row * cs;

            let owner = vm.vm.owner[i] as usize; // 0=unowned, 1-4=player
            let scrb = vm.vm.scrb[i];
            let is_pc = pc_owner[i] > 0;
            let is_ir = ir_flag[i];

            // Determine cell fill color
            let color: [u8; 4] = if is_ir && owner > 0 {
                // IR executing on owned cell: player color as background (inverted in ncurses)
                if scrb != 0 { player_bold_color(owner - 1) } else { player_color(owner - 1) }
            } else if is_ir && owner == 0 {
                // IR on unowned: gray bg
                if scrb != 0 { GRAY_BOLD } else { GRAY }
            } else if is_pc && owner == 0 {
                // PC on unowned: gray background (ncurses CP_BLACK_ON_GRAY)
                GRAY
            } else if owner > 0 {
                // Owned cell: player color on black bg
                if scrb != 0 { player_color(owner - 1) } else { player_dim_color(owner - 1) }
            } else {
                // Unowned
                if scrb != 0 {
                    GRAY
                } else if vm.vm.arena[i] != 0 {
                    DARK_GRAY
                } else {
                    NEAR_BLACK
                }
            };

            // Fill cell rectangle (inner area, gap remains as BG)
            fill_rect(&mut self.buffer, w, px, py, inner, inner, color);

            // PC indicator: dot in center of cell
            if is_pc && !is_ir {
                let dot = cmp::max(2, inner * 35 / 100);
                let dot_color: [u8; 4] = if owner > 0 { WHITE } else { BLACK };
                let dx = px + (inner - dot) / 2;
                let dy = py + (inner - dot) / 2;
                fill_rect(&mut self.buffer, w, dx, dy, dot, dot, dot_color);
            }
        }
    }

    /// Get the pixel width of the rendered image
    pub fn width(&self) -> usize { self.img_w }

    /// Get the pixel height of the rendered image
    pub fn height(&self) -> usize { self.img_h }

    /// Get the RGBA pixel buffer as a Uint8Array (zero-copy view into WASM memory).
    /// The view is valid until the next render() or configure() call.
    pub fn get_buffer(&self) -> js_sys::Uint8Array {
        unsafe { js_sys::Uint8Array::view(&self.buffer) }
    }
}

// ═══════════════════════════════════════════════════════════════
// WASM bridge for the Corewar Assembler
// ═══════════════════════════════════════════════════════════════

/// WASM bridge for the Corewar Assembler.
/// Compiles .s source code into .cor bytecode using the REAL Rust assembler.
/// Zero JavaScript reimplementation — same code as the CLI `asm` binary.
#[wasm_bindgen]
pub struct WasmAsm;

#[wasm_bindgen]
impl WasmAsm {
    /// Assemble a .s source string into a complete .cor file.
    /// Returns the raw .cor file bytes (header + bytecode).
    /// Throws a JS error if assembly fails (syntax error, unknown label, etc.).
    pub fn assemble(source: &str) -> Result<Vec<u8>, JsValue> {
        corewar_asm::assemble_from_str(source)
            .map_err(|e| JsValue::from_str(&format!("{}", e)))
    }

    /// Assemble a .s source string and return detailed info as JSON.
    /// JSON format: {"name":"...","comment":"...","code_size":123,"data":[...bytes...]}
    /// Throws a JS error if assembly fails.
    pub fn assemble_json(source: &str) -> Result<String, JsValue> {
        let (name, comment, code_size, cor_bytes) =
            corewar_asm::assemble_from_str_detailed(source)
                .map_err(|e| JsValue::from_str(&format!("{}", e)))?;

        // Convert cor_bytes to a JSON array of numbers
        let bytes_json: Vec<String> = cor_bytes.iter().map(|b| b.to_string()).collect();

        Ok(format!(
            r#"{{"name":"{}","comment":"{}","code_size":{},"header_size":{},"total_size":{},"data":[{}]}}"#,
            name.replace('"', "\\\""),
            comment.replace('"', "\\\""),
            code_size,
            cor_bytes.len() - code_size,
            cor_bytes.len(),
            bytes_json.join(",")
        ))
    }
}
