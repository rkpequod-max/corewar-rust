import re

durations = {
    # Common Core
    "libft": "40h", "ft_printf": "70h", "get_next_line": "70h", "born2beroot": "40h",
    "push_swap": "70h", "minitalk": "40h", "pipex": "70h", "so_long": "70h", "philosophers": "70h",
    "minishell": "175h", "fdf": "70h", "fract_ol": "70h", "netpractice": "40h",
    "cub3d": "175h", "miniRT": "175h", "inception": "175h", "ft_services": "175h",
    "ft_containers": "175h", "webserv": "175h", "ft_irc": "175h", "ft_transcendence": "350h",
    # Security
    "ft_ssl": "120h", "ft_ssl_des": "120h", "ft_ssl_rsa": "120h", "ft_otp": "70h",
    "ft_onion": "120h", "override": "120h", "taskmaster": "120h", "matt_daemon": "120h",
    "pest_control": "120h", "ft_ssl_md5": "70h", "ft_nmap": "70h", "deathwar": "175h",
    "famine": "120h", "pestilence": "120h", "woody-woodpacker": "120h", "durex": "175h",
    "boot2root": "175h", "snow-crash": "120h", "rainfall": "120h", "darkly": "120h",
    # Unix & Kernel
    "libasm": "40h", "malloc": "120h", "ft_select": "70h", "ft_ping": "70h", "ft_traceroute": "70h",
    "ft_nm_otool": "120h", "strace": "120h", "ft_linux": "120h", "kfs1": "70h", "kfs2": "70h",
    "kfs3": "70h", "kfs4": "70h", "kfs5": "70h", "kfs6": "70h", "kfs7": "70h", "kfs8": "70h",
    "kfs9": "70h", "kfs10": "120h", "ft_ls": "70h", "drivers-and-interrupt": "70h",
    "process-and-memory": "70h", "userspace_digression": "70h", "little-penguin-1": "70h",
    "filesystem": "70h", "kfs-x": "120h",
    # Graphics / OpenGL
    "scop": "120h", "mod1": "70h", "wolf3d": "70h", "humanity": "120h", "rt": "175h", "rtv1": "70h",
    "guimp": "120h", "ft_vox": "120h", "42run": "120h", "ft_ality": "120h", "humangl": "120h",
    "bomberman": "175h", "particle-system": "120h", "shaderpixel": "120h", "ft_newton": "120h",
    "gbmu": "175h",
    # OCaml
    "piscine_ocaml": "100h", "ft_turing": "120h", "f_ml": "120h", "ft_linear": "120h",
    "f_k_d_tree": "120h", "avion": "120h",
    # Algorithms
    "computor_v1": "70h", "computor_v2": "70h", "lemin": "120h", "corewar": "175h",
    "filler": "70h", "nibbler": "70h", "gomoku": "175h", "krpsim": "120h", "expert-system": "120h",
    "n-puzzle": "120h", "rubik": "120h", "zappy": "175h",
    # Java
    "piscine_java": "100h", "avaj-launcher": "70h", "swingy": "120h", "fix-me": "120h",
    "fwa": "120h", "goma": "120h", "message_queue": "120h", "restful": "120h",
    "ft_scale_server": "175h", "springboot": "120h", "microservices": "175h",
    # Swift
    "swifty-companion": "70h", "swifty-proteins": "120h", "t_hangouts": "120h",
    # Web / PHP / Ruby / Python
    "piscine_php": "100h", "symphony": "120h", "piscine_ruby": "100h", "myspotify": "120h",
    "django": "120h", "piscine_python": "100h", "camagru": "70h", "matcha": "120h",
    "hypertube": "175h", "red_tetris": "175h", "music_room": "175h", "cinema": "120h",
    "42sh": "175h",
    # Data Science
    "piscine_python_datascience": "100h", "dslr": "120h", "multilayer-perception": "120h",
    "tweets": "120h", "chum": "120h", "n_gram": "120h", "uber": "120h", "big_data": "175h",
    "predictive_analysis": "175h", "ft_linear_regression": "70h", "churn": "120h",
    "understanding_customer": "120h", "total-perspective-vortex": "120h",
    # Unity
    "piscine_unity": "100h", "in-the-shadows": "120h", "city_life": "120h", "fried_eggs": "120h",
    "amazon_xv": "120h", "h42n42": "120h",
    # Starfleet
    "starfleet": "100h", "cloud-1": "120h", "cpp_modules": "100h", "lem_ipc": "120h",
    "dr_quine": "70h"
}

filepath = "/home/rk/Downloads/corewar-rust-main/docs/holygraph.html"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# We look for nodes: [ ... ]
# Each node matches: { id: "some_id", ... skills: [...] }
def replacer(match):
    line = match.group(0)
    node_id_match = re.search(r'id:\s*"([^"]+)"', line)
    if node_id_match:
        node_id = node_id_match.group(1)
        duration = durations.get(node_id, "70h")  # Default to 70h if not found
        # Inject duration just before the skills array or the closing bracket
        # Let's insert it before the closing }
        # Ex: skills: [...] } -> skills: [...], duration: "40h" }
        if "duration:" not in line:
            line_updated = re.sub(r'\}\s*$', f', duration: "{duration}" }}', line.strip())
            return line_updated
    return line

# Find nodes list lines
lines = content.split("\n")
nodes_start = False
updated_lines = []

for line in lines:
    if "nodes: [" in line:
        nodes_start = True
        updated_lines.append(line)
        continue
    if nodes_start and "]," in line and "connections:" in lines[lines.index(line) + 1]:
        nodes_start = False
        updated_lines.append(line)
        continue
    
    if nodes_start and line.strip().startswith("{") and line.strip().endswith("},"):
        # Match nodes format: { id: "...", ... }
        node_id_match = re.search(r'id:\s*"([^"]+)"', line)
        if node_id_match:
            node_id = node_id_match.group(1)
            duration = durations.get(node_id, "70h")
            if "duration:" not in line:
                # Replace the closing }, with , duration: "..." },
                new_line = re.sub(r'\}\s*,\s*$', f', duration: "{duration}" }},', line)
                updated_lines.append(new_line)
                continue
    updated_lines.append(line)

new_content = "\n".join(updated_lines)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(new_content)

print("Nodes updated successfully!")
