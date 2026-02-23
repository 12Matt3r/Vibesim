from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console and errors
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser Error: {err}"))

        url = "http://localhost:8000/index.html"
        print(f"Navigating to {url}")
        page.goto(url)

        # Wait for dialog and handle it
        page.wait_for_timeout(2000)
        if page.is_visible('#vibesim-dialog'):
            print("Dialog detected, closing...")
            page.click('#dialog-confirm')
            page.wait_for_timeout(1000)
        else:
            print("Dialog not visible immediately.")

        # Close overlays (just in case)
        page.evaluate("""
            document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('show'));
            document.querySelectorAll('.snackbar').forEach(el => el.classList.remove('show'));
        """)

        # Open Settings
        print("Opening Settings...")
        settings_btn = page.locator('.activity-item[data-panel="settings"]')
        settings_btn.click(force=True)
        page.wait_for_timeout(1000)

        # Test Inputs
        print("Testing inputs...")
        try:
            page.fill("#custom-api-endpoint", "https://api.example.com")

            # Trigger click via JS
            print("Clicking save via JS...")
            page.evaluate("document.getElementById('save-integrations').click()")
            page.wait_for_timeout(500)

            val = page.evaluate("localStorage.getItem('vibesim_custom_endpoint')")
            if val == "https://api.example.com":
                print("SUCCESS: Settings saved.")
            else:
                print(f"FAILURE: Saved value: {val}")
        except Exception as e:
            print(f"Test Error: {e}")

        browser.close()

if __name__ == "__main__":
    run()
