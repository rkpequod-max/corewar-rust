---
Task ID: 1
Agent: main
Task: Fix visualizer flickering/trembling in corewar-rust

Work Log:
- Analyzed the current visualizer.rs (ncurses-based, ported from C version)
- Identified root cause: separate wrefresh() calls on 3 windows cause visual tearing between screen updates
- Also identified: delwin/newwin every frame is wasteful and potentially unstable
- Rewrote visualizer with:
  1. wnoutrefresh() on all 3 windows + single doupdate() for atomic screen updates
  2. werase() instead of delwin/newwin per frame — only recreate on KEY_RESIZE
  3. std::thread::sleep instead of libc::usleep
  4. Removed libc dependency from Cargo.toml
- Fixed type mismatch: COLOR_PAIR expects i16, not i32
- Built successfully with ncurses dev headers from local path
- Committed and pushed to GitHub

Stage Summary:
- Key fix: wnoutrefresh() + doupdate() ensures all 3 windows update atomically in one terminal refresh
- Commit: bfa5eda pushed to origin/main
- Previous wrefresh() approach caused 3 separate screen flushes per frame → visual tearing/trembling
