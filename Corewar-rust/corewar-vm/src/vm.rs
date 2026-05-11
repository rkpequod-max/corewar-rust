use corewar_common::constants::*;
use corewar_common::op_table::*;
use corewar_common::types::*;
use corewar_common::utils::*;

#[derive(Debug, Clone)]
pub struct Player {
    pub nplayer: i32,
    pub name: String,
    pub comment: String,
    pub code: Vec<u8>,
    pub prog_size: usize,
    pub pc_address: usize,
    pub nblive: i32,
    pub last_live_cycle: i32,
}

#[derive(Debug, Clone)]
pub struct Process {
    #[allow(dead_code)]
    pub nprocess: i32,
    pub carry: i32,
    pub reg: [i32; REG_NUMBER],
    pub pc: usize,
    pub duration: i32,
    pub live_count: i32,
    pub live_since: i32,
    pub owner: i32,
    pub ir: i32,      // -1 = no instruction, 0-15 = op index
    pub last_ir: i32,
    pub optab: usize,
}

pub struct Vm {
    pub arena: [u8; MEM_SIZE],
    pub owner: [u8; MEM_SIZE],
    pub scrb: [u8; MEM_SIZE],
    pub processes: Vec<Process>,
    pub players: Vec<Player>,
    pub dump_param: i32,
    pub verbose: bool,
    pub ncurses: bool,
    pub nplayers: usize,
    pub last_alive: i32,
    pub nprocess: i32,
    pub process_alive: i32,
    pub cycle_to_die: i32,
    pub diff_to_die: i32,
    pub cycles: i32,
    pub nchecks: i32,
    pub nlives: i32,
}

impl Vm {
    pub fn new() -> Self {
        Vm {
            arena: [0u8; MEM_SIZE],
            owner: [0u8; MEM_SIZE],
            scrb: [0u8; MEM_SIZE],
            processes: Vec::new(),
            players: Vec::new(),
            dump_param: -1,
            verbose: false,
            ncurses: false,
            nplayers: 0,
            last_alive: 0,
            nprocess: 0,
            process_alive: 0,
            cycle_to_die: CYCLE_TO_DIE,
            diff_to_die: 0,
            cycles: 0,
            nchecks: 0,
            nlives: 0,
        }
    }

    pub fn load_player(&mut self, file: &str, nplayer: Option<i32>) -> Result<(), String> {
        if !file_has_extension(file, ".cor") {
            return Err(format!("{} is not a .cor file", file));
        }

        let data = std::fs::read(file).map_err(|e| format!("Cannot open {}: {}", file, e))?;

        let header_size = Header::header_size();
        if data.len() < header_size {
            return Err(format!("{}: File too small", file));
        }

        // Validate magic
        validate_magic(&data).map_err(|e| format!("{}: {}", file, e))?;

        let header = Header::from_bytes(&data).map_err(|e| format!("{}: {}", file, e))?;

        let code_size = data.len() - header_size;
        if code_size > CHAMP_MAX_SIZE {
            return Err(format!("{}: Champion too large ({} bytes)", file, code_size));
        }

        let code = data[header_size..].to_vec();

        let player_num = match nplayer {
            Some(n) => n,
            None => -(self.nplayers as i32) - 1,
        };

        let player = Player {
            nplayer: player_num,
            name: header.prog_name_str(),
            comment: header.comment_str(),
            code,
            prog_size: code_size,
            pc_address: 0,
            nblive: 0,
            last_live_cycle: 0,
        };

        self.players.push(player);
        self.nplayers += 1;
        Ok(())
    }

    pub fn load_champions(&mut self) {
        let space = MEM_SIZE / self.nplayers;
        let mut ad: usize = 0;

        for (n, player) in self.players.iter_mut().enumerate() {
            let code_len = player.code.len();
            self.arena[ad..ad + code_len].copy_from_slice(&player.code[..code_len]);
            for j in 0..code_len {
                self.owner[ad + j] = (n + 1) as u8;
            }
            player.pc_address = ad;
            ad += space;
        }

        self.last_alive = self.players.last().map(|p| p.nplayer).unwrap_or(0);
    }

    pub fn load_processes(&mut self) {
        for (i, player) in self.players.iter().enumerate() {
            self.nprocess += 1;
            self.process_alive += 1;

            let mut reg = [0i32; REG_NUMBER];
            reg[0] = player.nplayer;

            let process = Process {
                nprocess: self.nprocess,
                carry: 0,
                reg,
                pc: player.pc_address,
                duration: 0,
                live_count: 0,
                live_since: 0,
                owner: (i + 1) as i32,
                ir: -1,
                last_ir: -1,
                optab: 0,
            };

            self.processes.push(process);

            if self.verbose {
                println!(
                    "PLAYER {} ({}), weight {} bytes, commentaire: {}",
                    player.nplayer,
                    player.name,
                    player.prog_size,
                    if player.comment.is_empty() {
                        "(empty)"
                    } else {
                        &player.comment
                    }
                );
            }
        }
    }

    fn in_mem(&self, pc: i32) -> u8 {
        self.arena[mem_mod(pc)]
    }

    fn store_at(&mut self, process_idx: usize, val: u32, address: i32) {
        let owner = self.processes[process_idx].owner as u8;
        let mut val = val;
        let mut address = address;
        for _ in 0..4 {
            let m = mem_mod(address);
            self.owner[m] = owner;
            self.scrb[m] = owner;
            self.arena[m] = (val & 0xFF) as u8;
            address -= 1;
            address = mem_mod(address) as i32;
            val >>= 8;
        }
    }

    fn get_arg_vm(&self, process_idx: usize, move_offset: &mut usize, arg_type: u8) -> i32 {
        let pc = self.processes[process_idx].pc as i32;
        let label_size: u8 = if (arg_type >> 2) != 0 { 2 } else { 4 };

        match arg_type & 0b11 {
            1 => {
                // Register
                let value = self.arena[mem_mod(pc + 2 + *move_offset as i32)];
                *move_offset += 1;
                self.processes[process_idx].reg[value as usize - 1]
            }
            2 => {
                // Direct
                let ret = reverse_bytes_circular(
                    &self.arena,
                    mem_mod(pc + 2 + *move_offset as i32),
                    label_size as usize,
                );
                *move_offset += label_size as usize;
                ret
            }
            3 => {
                // Indirect
                let value = reverse_bytes_circular(
                    &self.arena,
                    mem_mod(pc + 2 + *move_offset as i32),
                    2,
                ) % IDX_MOD;
                let ret = reverse_bytes_circular(
                    &self.arena,
                    mem_mod(pc + value),
                    4,
                );
                *move_offset += 2;
                ret
            }
            _ => 0,
        }
    }

    fn player_alive(&mut self, live: i32) {
        for i in 0..self.players.len() {
            if self.players[i].nplayer == live {
                println!(
                    "A process shows that player {} ({}) is alive",
                    self.players[i].nplayer, self.players[i].name
                );
                self.players[i].nblive += 1;
                self.players[i].last_live_cycle = self.cycles;
                self.last_alive = live;
                break;
            }
        }
    }

    fn add_process(&mut self, parent_idx: usize, pc: usize) {
        self.nprocess += 1;
        self.process_alive += 1;

        let parent = &self.processes[parent_idx];
        let new_process = Process {
            nprocess: self.nprocess,
            carry: parent.carry,
            reg: parent.reg,
            pc,
            duration: 0,
            live_count: parent.live_count,
            live_since: parent.live_since + 1,
            ir: -1,
            last_ir: -1,
            optab: 0,
            owner: parent.owner,
        };
        self.processes.push(new_process);
    }

    // Operation implementations

    fn op_live(&mut self, process_idx: usize) {
        self.processes[process_idx].live_count += 1;
        self.nlives += 1;
        let live = reverse_bytes_circular(
            &self.arena,
            mem_mod(self.processes[process_idx].pc as i32 + 1),
            4,
        );
        self.player_alive(live);
        self.processes[process_idx].pc = mem_mod(self.processes[process_idx].pc as i32 + 5);
        self.processes[process_idx].live_since = -1;
    }

    fn op_ld(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let reg_pos = self.processes[process_idx].pc as i32 + 6
            - ((acb & 0b01100000) >> 5) as i32;

        let p1 = p_acb(acb, 1);
        let p2 = p_acb(acb, 2);

        if (p1 == ACB_DIR || p1 == ACB_IND) && p2 == ACB_REG && is_reg_arena(&self.arena, reg_pos) {
            let move_val = if p1 == ACB_DIR {
                reverse_bytes_circular(
                    &self.arena,
                    mem_mod(self.processes[process_idx].pc as i32 + 2),
                    4,
                )
            } else {
                let addr = reverse_bytes_circular(
                    &self.arena,
                    mem_mod(self.processes[process_idx].pc as i32 + 2),
                    2,
                ) % IDX_MOD;
                reverse_bytes_circular(
                    &self.arena,
                    mem_mod(self.processes[process_idx].pc as i32 + addr),
                    4,
                )
            };
            let reg_num = self.arena[mem_mod(reg_pos)] as usize - 1;
            self.processes[process_idx].reg[reg_num] = move_val;
            self.processes[process_idx].carry = if move_val != 0 { 0 } else { 1 };
        }

        self.processes[process_idx].pc = mem_mod(
            self.processes[process_idx].pc as i32 + octal_shift(acb, 4, 2) as i32
        );
    }

    fn op_st(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let p1 = p_acb(acb, 1);
        let p2 = p_acb(acb, 2);
        let pc = self.processes[process_idx].pc as i32;

        if p1 == ACB_REG && is_reg_arena(&self.arena, pc + 2) {
            let reg_val = self.processes[process_idx].reg
                [self.arena[mem_mod(pc + 2)] as usize - 1];

            if p2 == ACB_REG && is_reg_arena(&self.arena, pc + 3) {
                let reg_num = self.arena[mem_mod(pc + 3)] as usize - 1;
                self.processes[process_idx].reg[reg_num] = reg_val;
            } else if p2 == ACB_IND {
                let move_val = reverse_bytes_circular(
                    &self.arena,
                    mem_mod(pc + 3),
                    2,
                );
                self.store_at(
                    process_idx,
                    reg_val as u32,
                    pc + (move_val % IDX_MOD),
                );
            }
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4, 2) as i32);
    }

    fn op_add(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let pc = self.processes[process_idx].pc as i32;

        if is_reg_arena(&self.arena, pc + 2) && is_reg_arena(&self.arena, pc + 3) && is_reg_arena(&self.arena, pc + 4) {
            let reg1 = self.processes[process_idx].reg[self.arena[mem_mod(pc + 2)] as usize - 1];
            let reg2 = self.processes[process_idx].reg[self.arena[mem_mod(pc + 3)] as usize - 1];
            let nb = reg1.wrapping_add(reg2);
            self.processes[process_idx].carry = if nb != 0 { 0 } else { 1 };
            self.processes[process_idx].reg[self.arena[mem_mod(pc + 4)] as usize - 1] = nb;
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4, 3) as i32);
    }

    fn op_sub(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let pc = self.processes[process_idx].pc as i32;

        if is_reg_arena(&self.arena, pc + 2) && is_reg_arena(&self.arena, pc + 3) && is_reg_arena(&self.arena, pc + 4) {
            let reg1 = self.processes[process_idx].reg[self.arena[mem_mod(pc + 2)] as usize - 1];
            let reg2 = self.processes[process_idx].reg[self.arena[mem_mod(pc + 3)] as usize - 1];
            let nb = reg1.wrapping_sub(reg2);
            self.processes[process_idx].carry = if nb != 0 { 0 } else { 1 };
            self.processes[process_idx].reg[self.arena[mem_mod(pc + 4)] as usize - 1] = nb;
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4, 3) as i32);
    }

    fn op_and(&mut self, process_idx: usize) {
        self.processes[process_idx].optab = 5;
        self.disect_args_cmp(process_idx, 0, |reg, id, n1, n2| {
            reg[id] = n1 & n2;
            (reg[id] != 0, reg[id])
        });
    }

    fn op_or(&mut self, process_idx: usize) {
        self.processes[process_idx].optab = 6;
        self.disect_args_cmp(process_idx, 0, |reg, id, n1, n2| {
            reg[id] = n1 | n2;
            (reg[id] != 0, reg[id])
        });
    }

    fn op_xor(&mut self, process_idx: usize) {
        self.processes[process_idx].optab = 7;
        self.disect_args_cmp(process_idx, 0, |reg, id, n1, n2| {
            reg[id] = n1 ^ n2;
            (reg[id] != 0, reg[id])
        });
    }

    fn op_zjmp(&mut self, process_idx: usize) {
        let move_val = reverse_bytes_circular(
            &self.arena,
            mem_mod(self.processes[process_idx].pc as i32 + 1),
            2,
        ) % IDX_MOD;

        if self.processes[process_idx].carry != 0 {
            self.processes[process_idx].pc = mem_mod(self.processes[process_idx].pc as i32 + move_val);
        } else {
            self.processes[process_idx].pc = mem_mod(self.processes[process_idx].pc as i32 + 3);
        }
    }

    fn op_ldi(&mut self, process_idx: usize) {
        self.processes[process_idx].optab = 9;
        self.disect_args_ldi(process_idx, true);
    }

    fn op_sti(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let mut args: i32 = 3;
        let mut mv: usize = 0;
        let mut nb = [0i32; 3];
        let pc = self.processes[process_idx].pc as i32;

        let op_args = OP_TABLE[10].args;
        if is_argsize(10, acb, 3, &op_args) {
            while args > 0 {
                args -= 1;
                let acb_type = (acb >> ((args + 1) * 2)) & 0b11;

                if acb_type == ACB_REG && !is_reg_arena(&self.arena, pc + 2 + mv as i32) {
                    break;
                }

                if args == 2 {
                    nb[2] = self.arena[mem_mod(pc + 2 + mv as i32)] as i32 - 1;
                    mv += 1;
                } else {
                    nb[args as usize] = self.get_arg_vm(process_idx, &mut mv, acb_type + 4);
                }

                if args == 0 {
                    let reg_val = self.processes[process_idx].reg[nb[2] as usize];
                    self.store_at(
                        process_idx,
                        reg_val as u32,
                        pc + ((nb[0].wrapping_add(nb[1])) % IDX_MOD),
                    );
                }
            }
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 2, 3) as i32);
    }

    fn op_fork(&mut self, process_idx: usize) {
        let move_val = reverse_bytes_circular(
            &self.arena,
            mem_mod(self.processes[process_idx].pc as i32 + 1),
            2,
        );
        let new_pc = mem_mod(self.processes[process_idx].pc as i32 + (move_val % IDX_MOD));
        self.add_process(process_idx, new_pc);
        self.processes[process_idx].pc = mem_mod(self.processes[process_idx].pc as i32 + 3);
    }

    fn op_lld(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let op_args = OP_TABLE[12].args;
        let pc = self.processes[process_idx].pc as i32;

        if is_argsize(12, acb, 2, &op_args) {
            let reg_pos = pc + 6 - ((acb & 0b01100000) >> 5) as i32;

            if is_reg_arena(&self.arena, reg_pos) {
                let move_val = if p_acb(acb, 1) == ACB_DIR {
                    reverse_bytes_circular(&self.arena, mem_mod(pc + 2), 4)
                } else {
                    let addr = reverse_bytes_circular(&self.arena, mem_mod(pc + 2), 2);
                    reverse_bytes_circular(&self.arena, mem_mod(pc + addr), 2)
                };
                let reg_num = self.arena[mem_mod(reg_pos)] as usize - 1;
                self.processes[process_idx].reg[reg_num] = move_val;
                self.processes[process_idx].carry = if move_val != 0 { 0 } else { 1 };
            }
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4, 2) as i32);
    }

    fn op_lldi(&mut self, process_idx: usize) {
        self.processes[process_idx].optab = 13;
        self.disect_args_lldi(process_idx);
    }

    fn op_lfork(&mut self, process_idx: usize) {
        let move_val = reverse_bytes_circular(
            &self.arena,
            mem_mod(self.processes[process_idx].pc as i32 + 1),
            2,
        );
        let new_pc = mem_mod(self.processes[process_idx].pc as i32 + move_val);
        self.add_process(process_idx, new_pc);
        self.processes[process_idx].pc = mem_mod(self.processes[process_idx].pc as i32 + 3);
    }

    fn op_aff(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let p1 = p_acb(acb, 1);
        let pc = self.processes[process_idx].pc as i32;

        if p1 == ACB_REG && is_reg_arena(&self.arena, pc + 2) {
            let reg_num = self.arena[mem_mod(pc + 2)] as usize - 1;
            let value = self.processes[process_idx].reg[reg_num] as u8;
            if self.verbose {
                println!("0x{:02x} : {:03}({:03}) :\t{}", value, value, self.processes[process_idx].reg[reg_num], value as char);
            } else {
                println!("{}", value as char);
            }
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4, 1) as i32);
    }

    /// Dissect arguments for and/or/xor operations (compare mode, l=0)
    fn disect_args_cmp<F>(&mut self, process_idx: usize, l: u8, f: F)
    where
        F: FnOnce(&mut [i32; REG_NUMBER], usize, i32, i32) -> (bool, i32),
    {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let op_idx = self.processes[process_idx].optab;
        let op_args = OP_TABLE[op_idx].args;

        let mut nb = [0i32; 3];
        let mut args: i32 = 3;
        let mut move_offset: usize = 0;
        let mut valid = true;
        let pc = self.processes[process_idx].pc as i32;

        if is_argsize(op_idx, acb, 3, &op_args) {
            while args > 0 {
                args -= 1;
                let acb_type = (acb >> ((args + 1) * 2)) & 0b11;

                if acb_type == ACB_REG && !is_reg_arena(&self.arena, pc + 2 + move_offset as i32) {
                    valid = false;
                    break;
                }

                if args > 0 {
                    nb[args as usize] = self.get_arg_vm(process_idx, &mut move_offset, acb_type + l * 2);
                }
            }

            if valid && args == 0 {
                // Last argument is always a register number
                let id = self.arena[mem_mod(pc + 2 + move_offset as i32)] as usize - 1;
                let n1 = nb[1];
                let n2 = nb[2];

                let (is_nonzero, result) = f(&mut self.processes[process_idx].reg, id, n1, n2);
                self.processes[process_idx].reg[id] = result;
                self.processes[process_idx].carry = if is_nonzero { 0 } else { 1 };
            }
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4 - l, 3) as i32);
    }

    /// Dissect args for ldi (load index with IDX_MOD)
    fn disect_args_ldi(&mut self, process_idx: usize, use_idx_mod: bool) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let op_idx = self.processes[process_idx].optab;
        let op_args = OP_TABLE[op_idx].args;

        let mut nb = [0i32; 3];
        let mut args: i32 = 3;
        let mut move_offset: usize = 0;
        let mut valid = true;
        let pc = self.processes[process_idx].pc as i32;
        let l: u8 = 2; // 2-byte dirs for ldi/lldi

        if is_argsize(op_idx, acb, 3, &op_args) {
            while args > 0 {
                args -= 1;
                let acb_type = (acb >> ((args + 1) * 2)) & 0b11;

                if acb_type == ACB_REG && !is_reg_arena(&self.arena, pc + 2 + move_offset as i32) {
                    valid = false;
                    break;
                }

                if args > 0 {
                    nb[args as usize] = self.get_arg_vm(process_idx, &mut move_offset, acb_type + l * 2);
                }
            }

            if valid && args == 0 {
                let id = self.arena[mem_mod(pc + 2 + move_offset as i32)] as usize - 1;
                let n1 = nb[1];
                let n2 = nb[2];

                let addr = if use_idx_mod {
                    mem_mod(pc + (n1.wrapping_add(n2)) % IDX_MOD)
                } else {
                    mem_mod(pc + n1.wrapping_add(n2))
                };

                self.processes[process_idx].reg[id] = reverse_bytes_circular(&self.arena, addr, 4);
            }
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4 - l, 3) as i32);
    }

    /// Dissect args for lldi (long load index without IDX_MOD)
    fn disect_args_lldi(&mut self, process_idx: usize) {
        let acb = self.in_mem(self.processes[process_idx].pc as i32 + 1);
        let op_idx = self.processes[process_idx].optab;
        let op_args = OP_TABLE[op_idx].args;

        let mut nb = [0i32; 3];
        let mut args: i32 = 3;
        let mut move_offset: usize = 0;
        let mut valid = true;
        let pc = self.processes[process_idx].pc as i32;
        let l: u8 = 2; // 2-byte dirs for lldi

        if is_argsize(op_idx, acb, 3, &op_args) {
            while args > 0 {
                args -= 1;
                let acb_type = (acb >> ((args + 1) * 2)) & 0b11;

                if acb_type == ACB_REG && !is_reg_arena(&self.arena, pc + 2 + move_offset as i32) {
                    valid = false;
                    break;
                }

                if args > 0 {
                    nb[args as usize] = self.get_arg_vm(process_idx, &mut move_offset, acb_type + l * 2);
                }
            }

            if valid && args == 0 {
                let id = self.arena[mem_mod(pc + 2 + move_offset as i32)] as usize - 1;
                let n1 = nb[1];
                let n2 = nb[2];

                let addr = mem_mod(pc + n1.wrapping_add(n2));
                self.processes[process_idx].reg[id] = reverse_bytes_circular(&self.arena, addr, 4);
                self.processes[process_idx].carry = if self.processes[process_idx].reg[id] != 0 { 0 } else { 1 };
            }
        }

        self.processes[process_idx].pc = mem_mod(pc + octal_shift(acb, 4 - l, 3) as i32);
    }

    fn execute_op(&mut self, process_idx: usize) {
        let ir = self.processes[process_idx].ir;
        if ir < 0 || ir > 15 {
            return;
        }
        match ir {
            0 => self.op_live(process_idx),
            1 => self.op_ld(process_idx),
            2 => self.op_st(process_idx),
            3 => self.op_add(process_idx),
            4 => self.op_sub(process_idx),
            5 => self.op_and(process_idx),
            6 => self.op_or(process_idx),
            7 => self.op_xor(process_idx),
            8 => self.op_zjmp(process_idx),
            9 => self.op_ldi(process_idx),
            10 => self.op_sti(process_idx),
            11 => self.op_fork(process_idx),
            12 => self.op_lld(process_idx),
            13 => self.op_lldi(process_idx),
            14 => self.op_lfork(process_idx),
            15 => self.op_aff(process_idx),
            _ => {}
        }
    }

    fn find_ir(&mut self, process_idx: usize) {
        let pc = self.processes[process_idx].pc;
        let ir = self.arena[pc] as i32;

        if ir > 0 && ir <= 16 {
            self.processes[process_idx].ir = ir - 1;
            self.processes[process_idx].last_ir = ir;
            self.processes[process_idx].duration = OP_TABLE[ir as usize - 1].cycle as i32 - 1;
        } else {
            self.processes[process_idx].ir = -1;
            self.processes[process_idx].pc = mem_mod(self.processes[process_idx].pc as i32 + 1);
        }
    }

    fn process_operations(&mut self) {
        if self.cycles % 200 == 0 {
            self.scrb = [0u8; MEM_SIZE];
        }

        let num_processes = self.processes.len();
        for i in 0..num_processes {
            let ir = self.processes[i].ir;
            if ir < 0 || ir > 15 {
                self.find_ir(i);
            }

            let ir = self.processes[i].ir;
            let duration = self.processes[i].duration;

            if duration == 0 && ir >= 0 && ir <= 15 {
                self.execute_op(i);
                self.processes[i].ir = -1;
            } else if duration > 0 {
                self.processes[i].duration -= 1;
            }

            self.processes[i].live_since += 1;
        }
    }

    fn kill_zombies(&mut self, check: bool) {
        if self.cycles > 0 && check {
            let cycle_to_die = self.cycle_to_die;
            self.processes.retain_mut(|p| {
                if p.live_count == 0 || cycle_to_die < 0 {
                    false // Process killed and removed from vector
                } else {
                    p.live_count = 0; // Process survives, reset its counter
                    true  // Keep it
                }
            });
            self.process_alive = self.processes.len() as i32;
        }
    }

    fn update_cycles(&mut self) {
        let mut reduce_cycles = false;

        if self.cycles > 0 && (self.cycles - self.diff_to_die) % self.cycle_to_die == 0 {
            if self.nlives >= NBR_LIVE {
                reduce_cycles = true;
            }
            self.nchecks = if reduce_cycles { 0 } else { self.nchecks + 1 };
            if self.nchecks >= MAX_CHECKS {
                self.nchecks = 0;
                reduce_cycles = true;
            }
            self.nlives = 0;
            for player in &mut self.players {
                player.nblive = 0;
            }
        }

        self.diff_to_die = if reduce_cycles { self.cycles } else { self.diff_to_die };
        if reduce_cycles {
            self.cycle_to_die -= CYCLE_DELTA;
        }
        self.cycles += 1;
    }

    pub fn print_ram(&self) {
        let mut line = 0;
        if self.verbose {
            print!("0x{:04x} | ", line);
        }
        for i in 0..MEM_SIZE {
            if self.verbose {
                print!("{:02x} ", self.arena[i]);
            } else {
                print!("{:02x}", self.arena[i]);
            }
            if i != 1 && (i + 1) % 32 == 0 {
                println!();
                line += 32;
                if self.verbose && i + 1 < MEM_SIZE {
                    print!("0x{:04x} | ", line);
                }
            }
        }
    }

    pub fn run(&mut self) {
        self.load_champions();
        self.load_processes();

        // Initialize visualizer if -n flag is set
        let mut vis: Option<crate::visualizer::Visualizer> = if self.ncurses {
            Some(crate::visualizer::Visualizer::init(self))
        } else {
            None
        };

        let mut quit = false;
        while !self.processes.is_empty() && self.cycle_to_die > 0 && !quit {
            // Handle ncurses input and display
            if let Some(ref mut v) = vis {
                let control = v.ncupdate(self);
                if control == 1 {
                    quit = true;
                    break;
                }
                if control == 2 {
                    // Paused — skip this cycle but keep window responsive
                    continue;
                }
                v.diff_draw(self);
            }

            if self.cycles == self.dump_param {
                self.print_ram();
                if let Some(ref mut v) = vis {
                    v.end();
                }
                return;
            }

            let check = self.cycles > 0
                && (self.cycles - self.diff_to_die) % self.cycle_to_die == 0;

            self.update_cycles();
            self.process_operations();
            self.kill_zombies(check);
        }

        // Cleanup and show winner
        if let Some(ref mut v) = vis {
            if !quit {
                v.show_winner(self);
                v.diff_draw(self);
                // Wait for user to press a key before exiting
                v.wait_for_key();
            }
            v.end();
        }

        if self.dump_param > 0 && self.dump_param > self.cycles {
            self.print_ram();
        } else if self.verbose && vis.is_none() {
            self.print_ram();
        }

        // Announce winner (text mode)
        if vis.is_none() {
            for player in &self.players {
                if self.last_alive == player.nplayer {
                    println!("Player {} ({}) won", player.nplayer, player.name);
                    return;
                }
            }
        }
    }
}
