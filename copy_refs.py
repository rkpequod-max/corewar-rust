import shutil
import os
import glob

def main():
    src_dir = "/home/rk/.gemini/antigravity/brain/ec029aef-5866-44d6-a995-dc2d0de53688"
    dest_dir = "/home/rk/Downloads/corewar-rust-main/docs"
    
    # Find all media__*.png and media__*.jpg files
    files = glob.glob(os.path.join(src_dir, "media__*"))
    for f in files:
        basename = os.path.basename(f)
        dest_path = os.path.join(dest_dir, basename)
        shutil.copy(f, dest_path)
        print(f"Copied {basename} to {dest_path}")
        
if __name__ == "__main__":
    main()
