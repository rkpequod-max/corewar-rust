use wasm_bindgen::prelude::*;
use corewar_vm::{Vm, VmEvent, Player, Process};
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
