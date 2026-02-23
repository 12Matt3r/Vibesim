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

        # Check login required dialog (might block UI)
        # "You must be logged in to Websim..."
        # If dialog exists, click OK/Close to proceed if possible, or just ignore since we are testing UI layout

        if page.is_visible('#vibesim-dialog'):
            print("Dialog detected, closing...")
            page.click('#dialog-confirm')
            page.wait_for_timeout(1000)

        # Click Console button
        print("Clicking Console button...")
        console_btn = page.locator('.activity-item[data-panel="console"]')
        console_btn.click()
        page.wait_for_timeout(1000)

        # Verify visibility
        console_panel = page.locator('#console-panel')
        if "active" in console_panel.get_attribute("class"):
            print("Console Panel is active.")
        else:
            print(f"Console Panel classes: {console_panel.get_attribute('class')}")

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

        page.screenshot(path="verification/console_http.png")

        browser.close()

if __name__ == "__main__":
    run()
