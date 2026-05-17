import re

def update_file(filepath, start_marker, end_marker, replacement):
    with open(filepath, 'r') as f:
        content = f.read()
    
    pattern = re.compile(f"({re.escape(start_marker)}.*?{re.escape(end_marker)}.*?\n)", re.DOTALL)
    new_content = pattern.sub(replacement, content)
    
    with open(filepath, 'w') as f:
        f.write(new_content)
    print(f"Updated {filepath}")

# Extract from index.html
with open('docs/index.html', 'r') as f:
    idx_content = f.read()

start_marker_idx = ".planet-atmosphere {"
end_marker_idx = ".cockpit-glass {\n            position: fixed; top: 15%; left: 0; width: 100%; height: 60%;\n            pointer-events: none; z-index: 9997;\n            background-color: rgba(255, 255, 255, 0.01);\n            transform: translate(calc(var(--cam-x) * -0.15), calc(var(--cam-y) * -0.15));\n        }"
pattern_idx = re.compile(f"({re.escape(start_marker_idx)}.*?{re.escape(end_marker_idx)})", re.DOTALL)

match = pattern_idx.search(idx_content)
if match:
    extracted_css = match.group(1)
    
    start_guide = ".planet-atmosphere {"
    end_guide = "filter: drop-shadow(0 0 6px rgba(0,212,255,0.8));\n}"
    
    update_file('docs/guide.css', start_guide, end_guide, extracted_css)
else:
    print("Could not extract CSS from index.html")
