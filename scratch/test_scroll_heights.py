import subprocess
import os
import time

def test_scroll(scroll_val):
    img_path = f"/home/rk/Downloads/corewar-rust-main/test_scroll_{scroll_val}.png"
    if os.path.exists(img_path):
        os.remove(img_path)
    
    cmd = [
        "chromium",
        "--headless=new",
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader-webgl",
        "--enable-unsafe-swiftshader",
        "--disable-http-cache",
        f"--screenshot={img_path}",
        "--window-size=1280,720",
        f"http://localhost:8002/docs/index.html?theme=ame&scroll={scroll_val}"
    ]
    
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    if os.path.exists(img_path):
        size = os.path.getsize(img_path)
        print(f"Scroll {scroll_val}: {size} bytes")
        return size
    else:
        print(f"Scroll {scroll_val}: Failed to capture")
        return 0

def main():
    # Wait to ensure server is ready
    time.sleep(1)
    for scroll in [0, 500, 1000, 1100, 1200, 1300, 1400, 1500, 1800, 2000, 2400]:
        test_scroll(scroll)

if __name__ == "__main__":
    main()
