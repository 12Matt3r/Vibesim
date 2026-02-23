from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Subscribe to console events
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        url = "http://localhost:8000/index.html"
        print(f"Navigating to {url}")
        page.goto(url)

        # Wait for init
        page.wait_for_timeout(3000)

        # Close login dialog if present
        if page.is_visible('#vibesim-dialog'):
            print("Dialog detected, closing...")
            page.click('#dialog-confirm')
            page.wait_for_timeout(1000)

        # Close Project Manager modal if present
        print("Checking for Project Manager modal...")
        if page.is_visible('#project-manager-modal'):
            print("Project Manager detected, forcing close...")
            page.evaluate("document.getElementById('project-manager-modal').classList.remove('show')")
            page.wait_for_timeout(1000)

        # Click Console button
        print("Clicking Console button...")
        console_btn = page.locator('.activity-item[data-panel="console"]')
        console_btn.click()
        page.wait_for_timeout(1000)

        # Verify visibility
        console_panel = page.locator('#console-panel')
        classes = console_panel.get_attribute("class")
        if "active" in classes:
            print("Console Panel is active.")
        else:
            print(f"Console Panel classes: {classes}")

        # Inject log
        print("Injecting log...")
        page.evaluate("""
            window.postMessage({ __vibesim_console: true, type: 'info', message: 'Hello Playwright' }, '*');
        """)
        page.wait_for_timeout(500)

        # Check logs
        logs = page.locator('#console-logs').inner_text()
        print(f"Logs content: {logs}")

        if "Hello Playwright" in logs:
            print("SUCCESS: Log found.")
        else:
            print("FAILURE: Log not found.")

        page.screenshot(path="verification/console_final.png")

        browser.close()

if __name__ == "__main__":
    run()
