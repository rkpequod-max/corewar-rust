mod vm;
#[cfg(feature = "visualizer")]
mod visualizer;

use clap::Parser;
use corewar_common::constants::*;

#[derive(Parser, Debug)]
#[command(name = "corewar", about = "Corewar virtual machine")]
struct Args {
    /// Dump memory after N cycles and exit
    #[arg(long)]
    dump: Option<i32>,

    /// Ncurses visualizer display
    #[arg(short = 'n')]
    ncurses: bool,

    /// Verbose output
    #[arg(short = 'v')]
    verbose: bool,

    /// Champion .cor files (with optional -n N prefix)
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    champions: Vec<String>,
}

fn main() {
    let args = Args::parse();

    // Parse -n player_number pairs from the champions list
    let mut players: Vec<(Option<i32>, String)> = Vec::new();
    let mut i = 0;
    let champs: Vec<String> = args.champions;
    while i < champs.len() {
        if champs[i] == "-n" && i + 2 < champs.len() {
            let n: i32 = champs[i + 1].parse().unwrap_or(0);
            if n <= 0 {
                eprintln!("Error: Invalid -n value");
                std::process::exit(1);
            }
            players.push((Some(n), champs[i + 2].clone()));
            i += 3;
        } else {
            players.push((None, champs[i].clone()));
            i += 1;
        }
    }

    if players.is_empty() || players.len() > MAX_PLAYERS {
        eprintln!("Error: Need 1-4 champion .cor files");
        std::process::exit(1);
    }

    let mut machine = vm::Vm::new();

    if let Some(dump) = args.dump {
        machine.dump_param = dump;
    }
    machine.verbose = args.verbose;
    machine.ncurses = args.ncurses;

    // Load champions
    for (nplayer, file) in &players {
        if let Err(e) = machine.load_player(file, *nplayer) {
            eprintln!("Error loading {}: {}", file, e);
            std::process::exit(1);
        }
    }

    #[cfg(feature = "visualizer")]
    {
        // Use the ncurses-enabled run() method
        machine.run();
    }

    #[cfg(not(feature = "visualizer"))]
    {
        // Headless mode: init and step
        machine.load_champions();
        machine.load_processes();

        while machine.step() {
            // Drain and print events
            for event in machine.drain_events() {
                match event {
                    vm::VmEvent::PlayerAlive { nplayer, name, cycle } => {
                        println!("A process shows that player {} ({}) is alive (cycle {})", nplayer, name, cycle);
                    }
                    vm::VmEvent::AffChar { ch } => {
                        print!("{}", ch);
                    }
                    vm::VmEvent::Winner { nplayer, name } => {
                        println!("Player {} ({}) won", nplayer, name);
                    }
                }
            }
        }

        // Print any remaining events
        for event in machine.drain_events() {
            match event {
                vm::VmEvent::PlayerAlive { nplayer, name, cycle } => {
                    println!("A process shows that player {} ({}) is alive (cycle {})", nplayer, name, cycle);
                }
                vm::VmEvent::AffChar { ch } => {
                    print!("{}", ch);
                }
                vm::VmEvent::Winner { nplayer, name } => {
                    println!("Player {} ({}) won", nplayer, name);
                }
            }
        }

        if machine.dump_param > 0 {
            machine.print_ram();
        }
    }
}
