from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load index.html
        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        print(f"Navigating to {url}")
        page.goto(url)

        # Wait for page load
        page.wait_for_load_state("domcontentloaded")

        # Click Console button in sidebar
        print("Clicking Console button...")
        console_btn = page.locator('.activity-item[data-panel="console"]')
        console_btn.click()

        # Verify Console Panel is visible
        console_panel = page.locator('#console-panel')
        if console_panel.is_visible():
            print("Console Panel is visible.")
        else:
            print("Console Panel is NOT visible.")

        # Check initial text
        print("Checking initial log...")
        page.wait_for_selector('#console-logs')
        content = page.locator('#console-logs').inner_text()
        print(f"Initial content: {content}")

        # Inject a log
        print("Injecting console log...")
        # We need to trigger the iframe logic or call logToConsole directly for testing UI.
        # Since iframe loading might be complex with file:// (cross-origin),
        # let's try calling the exposed function or triggering the event.
        # But wait, logToConsole is global in script.js (module).
        # script.js is type="module", so it's not global.
        # However, we can simulate the event.

        page.evaluate("""
            window.postMessage({ __vibesim_console: true, type: 'info', message: 'Hello Playwright' }, '*');
        """)

        # Wait for log to appear
        page.wait_for_function("document.getElementById('console-logs').innerText.includes('Hello Playwright')")
        print("Log appeared!")

        # Take screenshot 1
        page.screenshot(path="verification/console_log.png")

        # Clear console
        print("Clearing console...")
        page.locator('#clear-console').click()

        # Verify cleared
        page.wait_for_function("document.getElementById('console-logs').innerText.includes('Console cleared')")
        print("Console cleared!")

        # Take screenshot 2
        page.screenshot(path="verification/console_cleared.png")

        browser.close()

if __name__ == "__main__":
    run()
