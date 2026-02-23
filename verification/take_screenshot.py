from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "http://localhost:8000/index.html"
        page.goto(url)
        page.wait_for_timeout(2000)

        # Handle Dialog
        if page.is_visible('#vibesim-dialog'):
            page.click('#dialog-confirm')
            page.wait_for_timeout(1000)

        # Close overlays
        page.evaluate("""
            document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('show'));
            document.querySelectorAll('.snackbar').forEach(el => el.classList.remove('show'));
        """)

        # Open Settings
        settings_btn = page.locator('.activity-item[data-panel="settings"]')
        settings_btn.click(force=True)
        page.wait_for_timeout(1000)

        # Take Screenshot
        page.screenshot(path="verification/integrations_final.png")
        print("Screenshot taken.")

        browser.close()

if __name__ == "__main__":
    run()
