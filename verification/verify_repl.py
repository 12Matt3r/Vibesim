from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console to debug JS errors
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        url = "http://localhost:8000/index.html"
        print(f"Navigating to {url}")
        page.goto(url)

        # Wait for init
        page.wait_for_timeout(3000)

        # Handle Dialog - It blocks init()!
        # Check if dialog is present (it has class 'show')
        dialog = page.locator('#vibesim-dialog')
        if "show" in (dialog.get_attribute("class") or ""):
            print("Dialog detected (visible). Clicking OK to unblock init...")
            page.click('#dialog-confirm')
            page.wait_for_timeout(1000)
        else:
            print("Dialog not visible. Trying to find it anyway...")
            # If it's there but not 'show', maybe it was dismissed?
            # Or maybe it hasn't appeared yet?
            # Let's try to forcefully click the confirm button using JS to resolve the promise if it's pending
            page.evaluate("document.getElementById('dialog-confirm')?.click()")
            page.wait_for_timeout(1000)

        # Handle Project Manager
        pm = page.locator('#project-manager-modal')
        if "show" in (pm.get_attribute("class") or ""):
             print("Project Manager detected. Closing...")
             # Just remove class to hide it visually, or click close
             # page.evaluate("document.getElementById('project-manager-modal').classList.remove('show')")
             # Better to leave it if it doesn't block interaction?
             # But sidebar click might be intercepted.
             page.evaluate("document.getElementById('project-manager-modal').classList.remove('show')")
             page.wait_for_timeout(500)

        # Click Console button
        print("Clicking Console button...")
        console_btn = page.locator('.activity-item[data-panel="console"]')
        console_btn.click(force=True)
        page.wait_for_timeout(1000)

        # Verify visibility
        console_panel = page.locator('#console-panel')
        classes = console_panel.get_attribute("class")
        print(f"Console Panel classes: {classes}")

        if "active" not in classes:
            print("Forcing Console Panel active...")
            page.evaluate("document.getElementById('console-panel').classList.add('active')")
            page.wait_for_timeout(500)

        # Verify Input
        input_field = page.locator('#console-input')
        if input_field.is_visible():
            print("Input field visible.")
        else:
            print("Input field NOT visible.")

        # Execute Command
        print("Executing command: 1 + 1")
        try:
            input_field.fill("1 + 1")
            input_field.press("Enter")
            page.wait_for_timeout(1000)

            # Check logs
            logs = page.locator('#console-logs').inner_text()
            print(f"Logs content: {logs}")

            if "> 1 + 1" in logs:
                print("SUCCESS: Command echoed.")
            else:
                print("FAILURE: Command echo not found.")

            if "[LOG] 2" in logs:
                 print("SUCCESS: Result logged.")
            else:
                 print("FAILURE: Result log not found.")

            # Execute console.log
            print("Executing console.log...")
            input_field.fill("console.log('REPL Working')")
            input_field.press("Enter")
            page.wait_for_timeout(1000)

            logs = page.locator('#console-logs').inner_text()
            if "REPL Working" in logs:
                print("SUCCESS: console.log from REPL worked.")

            page.screenshot(path="verification/console_repl.png")
        except Exception as e:
            print(f"Error during interaction: {e}")
            page.screenshot(path="verification/error.png")

        browser.close()

if __name__ == "__main__":
    run()
