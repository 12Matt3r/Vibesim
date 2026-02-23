from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Subscribe to console events
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser Error: {err}"))

        # Load index.html
        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        print(f"Navigating to {url}")
        page.goto(url)

        # Wait for page load
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(2000) # Wait for init

        # Click Console button in sidebar
        print("Clicking Console button...")
        console_btn = page.locator('.activity-item[data-panel="console"]')
        if console_btn.count() == 0:
            print("Console button not found!")
        else:
            console_btn.click()

        page.wait_for_timeout(1000) # Wait for UI update

        # Verify Console Panel visibility
        console_panel = page.locator('#console-panel')
        # Check class list
        classes = console_panel.get_attribute("class")
        print(f"Console Panel Classes: {classes}")

        if "active" in classes:
             print("Console Panel has active class.")

        # Try to force show if script failed
        # page.evaluate("document.getElementById('console-panel').classList.add('active')")

        # Inject a log
        print("Injecting console log event...")
        page.evaluate("""
            window.postMessage({ __vibesim_console: true, type: 'info', message: 'Hello Playwright' }, '*');
        """)

        page.wait_for_timeout(1000)

        # Take screenshot
        page.screenshot(path="verification/console_debug.png")
        print("Screenshot taken.")

        browser.close()

if __name__ == "__main__":
    run()
