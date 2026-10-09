# /// script
# requires-python = ">=3.10"
# dependencies = ["selenium>=4.27"]
# ///
"""Tests the frontend in Firefox with real input.

Drives an installed Firefox with Selenium (WebDriver) against a running
server: mouse and keyboard at desktop width, touch at the narrowest width
Firefox allows (500 px). It creates its own category and habits, deletes them
afterwards and restores the settings it changes. Undo steps of its changes
stay behind, so run it against a scratch database, not your own:

    HABITS_ADDR=127.0.0.1:8091 HABITS_DB=/tmp/habits-scratch.db go run .
    uv run scripts/firefox_test.py http://127.0.0.1:8091

The checks do not depend on the UI language. Selenium Manager finds the
installed Firefox and fetches geckodriver; FIREFOX names another binary.
With --screenshots DIR, screenshots of the main screens are saved there.
"""

import argparse
import os
import sys
import time

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions import interaction
from selenium.webdriver.common.actions.action_builder import ActionBuilder
from selenium.webdriver.common.actions.pointer_input import PointerInput
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.firefox.options import Options

# A daily frequency, as the API takes it.
DAILY = {
    "kind": "daily", "timesPerWeek": 0, "timesPerMonth": 0, "weekdays": 0,
    "intervalDays": 0, "weekInterval": 0, "weekOfMonth": 0, "anchorDate": "",
}


class Run:
    """A Firefox session against the app, with the checks' results."""

    def __init__(self, base, screenshots, width, height, touch=False):
        self.base = base.rstrip("/")
        self.screenshots = screenshots
        self.results = []
        self.errors = []
        opts = Options()
        opts.add_argument("-headless")
        if os.environ.get("FIREFOX"):
            opts.binary_location = os.environ["FIREFOX"]
        # BiDi reports the page's JavaScript errors.
        opts.enable_bidi = True
        if touch:
            opts.set_preference("dom.w3c_touch_events.enabled", 1)
        self.driver = webdriver.Firefox(options=opts)
        self.driver.set_window_rect(width=width, height=height)
        self.driver.script.add_javascript_error_handler(
            lambda entry: self.errors.append(getattr(entry, "text", str(entry))))

    def close(self):
        self.driver.quit()

    # ---------- page access ----------

    def js(self, code, *args):
        """Runs `code` as the body of an async function and returns its
        result; `arguments` holds `args` (and, last, WebDriver's callback)."""
        return self.driver.execute_async_script(
            "const done = arguments[arguments.length - 1];"
            "(async () => {" + code + "})()"
            ".then(done, (e) => done({error: String(e && e.stack || e)}));",
            *args)

    def api(self, method, path, body=None):
        """Calls the API from the page, so it acts as the page's user."""
        return self.js("""
            const [method, path, body] = arguments;
            const res = await fetch(path, {
              method,
              headers: body ? {'Content-Type': 'application/json'} : {},
              body: body ? JSON.stringify(body) : undefined,
            });
            const text = await res.text();
            return text ? JSON.parse(text) : null;""", method, path, body)

    def find(self, css):
        """Finds an element and scrolls it to the middle of the viewport, as
        WebDriver's pointer actions need it in view."""
        element = self.driver.find_element(By.CSS_SELECTOR, css)
        self.driver.execute_script(
            "arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});",
            element)
        return element

    def actions(self):
        return ActionChains(self.driver)

    def click(self, css):
        self.actions().move_to_element(self.find(css)).click().perform()

    def keys(self, *keys):
        self.actions().send_keys(*keys).perform()

    def touch(self, css, hold=0.0):
        """Taps the element, or presses it for `hold` seconds."""
        finger = PointerInput(interaction.POINTER_TOUCH, "finger")
        builder = ActionBuilder(self.driver, mouse=finger)
        builder.pointer_action.move_to(self.find(css)).pointer_down()
        if hold:
            builder.pointer_action.pause(hold)
        builder.pointer_action.pointer_up()
        builder.perform()

    def label(self, css):
        """Returns an element's aria-label, without scrolling, which would
        hide a tooltip."""
        return self.js(
            "return document.querySelector(arguments[0]).getAttribute('aria-label');",
            css)

    def is_open(self, dialog_id):
        return self.js(
            "return document.getElementById(arguments[0])?.open ?? false;",
            dialog_id)

    def shown(self, view_id):
        return self.js(
            "return !document.getElementById(arguments[0]).hidden;", view_id)

    def tooltip(self):
        """Returns the text of the shown tooltip, or None."""
        return self.js("""
            const tip = document.querySelector('.tooltip');
            return tip?.matches(':popover-open') ? tip.textContent : null;""")

    def load(self):
        self.driver.get(self.base + "/")
        time.sleep(2)

    def screenshot(self, name):
        if self.screenshots:
            self.driver.save_screenshot(
                os.path.join(self.screenshots, f"{name}.png"))

    # ---------- results ----------

    def check(self, name, ok, detail=""):
        self.results.append((name, bool(ok)))
        print(f"{'OK  ' if ok else 'FAIL'} {name}"
              + (f"  ({detail})" if detail else ""), flush=True)


class Fixture:
    """A category with a check habit and a count habit (target 3, step 1)
    for the checks, and the settings to restore afterwards."""

    def __init__(self, run):
        self.run = run
        self.settings = run.api("GET", "/api/settings")
        self.category = run.api("POST", "/api/categories", {"name": "Firefox test"})["id"]
        run.api("PATCH", f"/api/categories/{self.category}", {
            "name": "Firefox test", "color": "teal", "icon": "star",
            "showProgress": True})
        self.check_habit = self._habit({
            "name": "Firefox check", "color": "blue", "icon": "moon",
            "kind": "check", "targetValue": 1})
        # Counts are stored in tenths: 30 is 3, 10 is 1.
        self.count_habit = self._habit({
            "name": "Firefox count", "color": "orange", "icon": "",
            "kind": "count", "unit": "glasses", "targetValue": 30,
            "stepValue": 10})
        self.today = run.api("GET", "/api/state")["today"]

    def _habit(self, fields):
        body = {"categoryId": self.category, "unit": "", "targetType": "at_least",
                "frequency": DAILY, **fields}
        return self.run.api("POST", "/api/habits", body)["id"]

    def remove(self):
        run = self.run
        for habit in (self.check_habit, self.count_habit):
            run.api("DELETE", f"/api/habits/{habit}")
        run.api("DELETE", f"/api/categories/{self.category}")
        run.api("PATCH", "/api/settings", self.settings)

    def cell(self, habit, date=None):
        return (f'.board-habit-row[data-habit="{habit}"] '
                f'.board-day-cell[data-date="{date or self.today}"]')

    def done(self, habit, date=None):
        return self.run.js(
            "return !!document.querySelector(arguments[0] + ' .board-day-cell-mark.is-complete');",
            self.cell(habit, date))

    def value(self, habit, date=None):
        entries = self.run.api("GET", f"/api/habits/{habit}")["entries"]
        return entries.get(date or self.today, 0)


# ---------------------------------------------------------------- desktop

def desktop(run, f):
    board_input(run, f)
    closed_day(run, f)
    search_and_views(run, f)
    editor(run, f)
    statistics_years(run, f)
    category_picker(run, f)
    arranging(run, f)
    grouping(run, f)
    settings(run, f)
    import_undo(run, f)


def board_input(run, f):
    """Mouse and keyboard on the board."""
    run.click(f.cell(f.check_habit))
    time.sleep(0.3)
    orbs = run.js("return document.querySelectorAll('.board-day-summary-orb').length;")
    time.sleep(1.8)
    run.check("click ticks off a habit", f.done(f.check_habit))
    run.check("orbs fly into the ring", orbs > 0, f"{orbs} orbs")
    progress = run.js(f"""return document.querySelector(
        '.board-block[data-category="{f.category}"] .board-block-progress-count')?.textContent;""")
    run.check("category progress counts it", progress == "1/2", str(progress))

    run.click(f.cell(f.count_habit))
    time.sleep(1)
    run.check("click adds a step", f.value(f.count_habit) == 10)

    run.actions().context_click(run.find(f.cell(f.count_habit))).perform()
    time.sleep(0.4)
    run.check("right-click opens the day dialog", run.is_open("day-editor"))
    run.check("the value has the focus",
              run.js("return document.activeElement?.name;") == "value")
    # A whole number, as Firefox reads decimals in the page's language.
    run.keys("4", Keys.ENTER)
    time.sleep(1)
    run.check("Enter saves the typed value",
              not run.is_open("day-editor") and f.value(f.count_habit) == 40
              and f.done(f.count_habit))
    # Only if no other habit is due today, as in a scratch database.
    if run.js("return !!document.querySelector('.board-day-summary.is-complete');"):
        confetti = run.js("""
            for (let i = 0; i < 30; i++) {
              const n = document.querySelectorAll('.board-day-summary-confetti').length;
              if (n > 0) return n;
              await new Promise((r) => setTimeout(r, 100));
            }
            return 0;""")
        run.check("the perfect day throws confetti", confetti > 0, f"{confetti} pieces")

    run.actions().context_click(run.find(f.cell(f.count_habit))).perform()
    time.sleep(0.3)
    run.keys(Keys.ESCAPE)
    time.sleep(0.4)
    run.check("Escape closes the day dialog", not run.is_open("day-editor"))

    # The day cells are a single tab stop moved by the arrow keys.
    run.js(f"document.querySelector('{f.cell(f.count_habit)}').focus();")
    run.keys(Keys.ARROW_LEFT)
    focus = run.js("return document.activeElement.dataset.date;")
    run.check("arrow keys move along the row", focus < f.today, str(focus))
    run.keys(Keys.SPACE)
    time.sleep(1.2)
    run.check("Space records the focused day, which keeps the focus",
              f.value(f.count_habit, focus) == 10
              and run.js("return document.activeElement.dataset.role;") == "cell")
    run.keys(Keys.SPACE)
    time.sleep(1.2)

    run.js("document.activeElement.blur();")
    run.click(f.cell(f.check_habit))
    time.sleep(1.2)
    run.check("clearing offers undo in a toast",
              run.js("return !!document.querySelector('.toast-list .toast-list-item:last-child .button');"))
    run.actions().key_down(Keys.CONTROL).send_keys("z").key_up(Keys.CONTROL).perform()
    time.sleep(1.5)
    run.check("Ctrl+Z undoes it", f.done(f.check_habit))

    run.actions().move_to_element(run.find("#open-settings")).perform()
    time.sleep(0.9)
    tip = run.tooltip()
    run.check("hovering shows a tooltip", tip == run.label("#open-settings"), str(tip))
    run.actions().move_by_offset(-300, 200).perform()
    time.sleep(0.3)


def closed_day(run, f):
    """A day the habit is no longer due on only offers to clear its value."""
    weekday = run.js("""
        const day = new Date(arguments[0] + 'T00:00:00Z');
        return (day.getUTCDay() + 6) % 7;""", f.today)
    habit = f._habit({
        "name": "Firefox weekly", "color": "red", "icon": "", "kind": "check",
        "targetValue": 1, "frequency": {**DAILY, "kind": "weekdays", "weekdays": 1 << weekday}})
    run.api("PUT", f"/api/habits/{habit}/entries/{f.today}", {"value": 1})
    other = {**DAILY, "kind": "weekdays", "weekdays": 1 << ((weekday + 1) % 7)}
    run.api("PATCH", f"/api/habits/{habit}", {"frequency": other, "retroactive": True})
    run.load()

    run.actions().context_click(run.find(f.cell(habit))).perform()
    time.sleep(0.4)
    dialog = run.js("""
        const dialog = document.getElementById('day-editor');
        return {open: dialog.open,
                value: !!dialog.querySelector('.day-editor-value'),
                buttons: dialog.querySelectorAll('.dialog-foot button').length,
                focus: document.activeElement.dataset.role};""")
    run.check("a day not due offers only to clear it",
              dialog["open"] and not dialog["value"] and dialog["buttons"] == 1
              and dialog["focus"] == "clear", str(dialog))
    run.keys(Keys.ESCAPE)
    time.sleep(0.4)
    run.api("DELETE", f"/api/habits/{habit}")
    run.load()


def search_and_views(run, f):
    """Search, the category and habit views and their overflow menu."""
    run.js("document.activeElement.blur();")
    run.keys("/")
    time.sleep(0.4)
    run.check("/ opens the search", run.is_open("search-dialog"))
    run.keys("Firefox test")
    time.sleep(0.4)
    first = run.js("return document.querySelector('.search-option-name')?.textContent;")
    run.check("the search filters", first == "Firefox test", str(first))
    run.keys(Keys.ENTER)
    time.sleep(1)
    run.check("Enter opens the result", run.shown("category-view"))
    run.keys(Keys.ESCAPE)
    time.sleep(0.8)
    run.check("Escape returns to the board",
              run.shown("board-view") and run.js("return location.hash;") == "")

    run.click(f'.board-habit-label[data-habit="{f.check_habit}"]')
    time.sleep(1.2)
    run.check("clicking a name opens the habit view", run.shown("habit-view"))
    run.screenshot("habit-view")

    menu = "#habit-view .app-bar-menu"
    run.click("#habit-view [popovertarget]")
    time.sleep(0.4)
    run.check("the menu opens with its first item focused", run.js(f"""
        const menu = document.querySelector('{menu}');
        return menu.matches(':popover-open')
            && document.activeElement === menu.querySelector('.app-bar-menu-item');"""))
    run.keys(Keys.ARROW_DOWN)
    run.check("arrow keys move in the menu", run.js(f"""
        return document.activeElement ===
            document.querySelector('{menu} .app-bar-menu-item:nth-child(2)');"""))
    errors = len(run.errors)
    run.keys(Keys.ESCAPE)
    time.sleep(0.4)
    tip = run.tooltip()
    run.check("Escape closes only the menu and returns the focus",
              run.shown("habit-view")
              and run.js("return document.activeElement.hasAttribute('popovertarget');"))
    run.check("the menu button's tooltip shows without an error",
              len(run.errors) == errors
              and tip == run.label("#habit-view [popovertarget]"),
              f"{tip}, {run.errors[errors:]}")

    # The second item archives; the toast undoes it.
    run.click("#habit-view [popovertarget]")
    time.sleep(0.3)
    run.click(f"{menu} .app-bar-menu-item:nth-child(2)")
    time.sleep(1.2)
    archived = lambda: run.api("GET", f"/api/habits/{f.check_habit}")["archivedAt"]
    run.check("archiving from the menu returns to the board",
              run.shown("board-view") and archived())
    run.click(".toast-list .toast-list-item:last-child .button")
    time.sleep(1.5)
    run.check("undo in the toast reactivates the habit",
              not archived()
              and run.js(f"return !!document.querySelector('.board-habit-row[data-habit=\"{f.check_habit}\"]');"))

    run.click(f'.board-habit-label[data-habit="{f.check_habit}"]')
    time.sleep(1.2)
    square = run.find("#habit-view .heatmap-day.is-today")
    run.actions().move_to_element(square).perform()
    time.sleep(0.3)
    status = square.get_attribute("data-status")
    tip = run.tooltip() or ""
    run.check("hovering the heatmap shows the day", tip.endswith(status) and len(tip) > len(status), tip)


def statistics_years(run, f):
    """The category view and the day statistics go back to an earlier year of
    the history, which an entry of the check habit opens."""
    year = int(f.today[:4])
    earlier = f"{year - 1}-06-15"
    run.api("PUT", f"/api/habits/{f.check_habit}/entries/{earlier}", {"value": 1})
    run.load()

    heading = "return document.querySelector(arguments[0] + ' .app-year-navigation h3').textContent;"
    run.click(f'.board-block[data-category="{f.category}"] [data-role="open-category"]')
    time.sleep(1.2)
    run.check("the category view shows this year",
              str(year) in run.js(heading, "#category-view"))
    run.click('#category-view [data-action="year-earlier"]')
    time.sleep(1.5)
    perfect = run.js(f"""return !!document.querySelector(
        '#category-view .heatmap-day.is-perfect[data-date="{earlier}"]');""")
    run.check("its arrow shows the year before, with its perfect days",
              str(year - 1) in run.js(heading, "#category-view") and perfect)
    run.keys(Keys.ESCAPE)
    time.sleep(0.8)

    run.click('[data-role="open-days"]')
    time.sleep(1.5)
    sub = "return document.querySelector('#day-stats-view .app-bar-sub').textContent;"
    run.check("the day statistics show this year", str(year) in run.js(sub))
    run.click('#day-stats-view [data-action="year-earlier"]')
    time.sleep(1.5)
    counted = run.js(f"""return document.querySelector(
        '#day-stats-view .heatmap-day[data-date="{earlier}"]')?.style.getPropertyValue('--rate');""")
    run.check("their arrow shows the year before",
              str(year - 1) in run.js(sub) and counted, f"{run.js(sub)}, {counted}")
    run.keys(Keys.ESCAPE)
    time.sleep(0.8)
    run.api("PUT", f"/api/habits/{f.check_habit}/entries/{earlier}", {"value": 0})
    run.load()


def editor(run, f):
    """The habit editor: guarding unsaved changes, and creating a habit."""
    edit = "#habit-view .app-bar-actions > .icon-button:not([popovertarget])"
    run.click(edit)
    time.sleep(0.5)
    run.check("the edit button opens the editor", run.is_open("habit-editor"))
    run.find('#habit-editor input[name="name"]').send_keys(" changed")
    run.keys(Keys.ESCAPE)
    time.sleep(0.5)
    run.check("Escape with changes asks first",
              run.is_open("discard-dialog") and run.is_open("habit-editor"))
    run.check("keep editing has the focus",
              run.js("return document.activeElement.value;") == "keep")
    run.keys(Keys.ENTER)
    time.sleep(0.5)
    run.check("keep editing leaves the editor open",
              run.is_open("habit-editor") and not run.is_open("discard-dialog"))
    run.driver.back()
    time.sleep(0.6)
    run.check("the browser's back button asks too", run.is_open("discard-dialog"))
    run.click('#discard-dialog button[value="discard"]')
    time.sleep(0.8)
    run.check("discarding closes the editor",
              not run.is_open("habit-editor") and run.shown("habit-view"))

    run.click("#habit-view .app-bar > .icon-button:first-child")
    time.sleep(0.8)
    run.check("the back button returns to the board", run.shown("board-view"))

    run.js("document.activeElement.blur();")
    run.keys("n")
    time.sleep(0.5)
    run.check("n opens the editor for a new habit",
              run.is_open("habit-editor")
              and run.js("return document.activeElement.name;") == "name")
    run.keys("Firefox new")
    run.click('#habit-editor input[name="kind"][value="time"]')
    run.click('#habit-editor input[name="freq"][value="weekdays"]')
    time.sleep(0.3)
    run.click("#habit-editor .weekday")
    target = run.find('#habit-editor input[name="targetTime"]')
    target.clear()
    target.send_keys("15")
    run.click('#habit-editor .page-head button[type="submit"]')
    time.sleep(1.2)
    habits = run.api("GET", "/api/state")["habits"]
    new = next((h for h in habits if h["name"] == "Firefox new"), None)
    schedule = new and new["schedules"][-1]
    run.check("the new habit is created as entered",
              new and new["kind"] == "time" and schedule["targetValue"] == 150
              and schedule["frequency"]["weekdays"] == 1, str(schedule))
    if new:
        run.api("DELETE", f"/api/habits/{new['id']}")
        run.load()


def category_picker(run, f):
    """A category that cannot be created says why in the picker, whose page
    covers the toasts. The request fails as without a connection."""
    run.js("document.activeElement.blur();")
    run.keys("n")
    time.sleep(0.5)
    run.click("#habit-editor-category")
    time.sleep(0.5)
    run.js("""
        const real = window.fetch;
        window.fetch = (url, options) =>
            options?.method === 'POST' && String(url).endsWith('/api/categories') ?
            Promise.reject(new TypeError('offline')) : real(url, options);
        window.restoreFetch = () => { window.fetch = real; };""")
    run.find('#category-picker input[name="name"]').send_keys("Firefox failed")
    run.click('#category-picker .category-picker-create button[type="submit"]')
    time.sleep(0.6)
    error = run.js("return document.querySelector('#category-picker .error')?.textContent.trim();")
    run.check("a failed category shows its error in the picker",
              run.is_open("category-picker") and error, str(error))
    run.js("window.restoreFetch();")
    run.keys(Keys.ESCAPE)
    time.sleep(0.4)
    run.keys(Keys.ESCAPE)
    time.sleep(0.6)
    run.check("Escape closes the picker, then the unchanged editor",
              not run.is_open("category-picker") and not run.is_open("habit-editor"))


def arranging(run, f):
    """Drag and drop in arrange mode, switched on in the settings."""
    # The filter would hide habits and handles, so arranging turns it off.
    filter_on = """return document.getElementById('filter-open-habits')
        .getAttribute('aria-pressed') === 'true';"""
    run.click("#filter-open-habits")
    time.sleep(0.4)
    run.click("#open-settings")
    time.sleep(0.4)
    run.click('#settings-dialog [data-page="settings-board"]')
    time.sleep(0.4)
    run.click('#settings-board input[name="settings-reorder"][value="drag"]')
    run.click("#settings-board .switch input")
    time.sleep(0.5)
    run.driver.back()
    time.sleep(0.4)
    run.driver.back()
    time.sleep(0.6)
    run.check("the browser's back button closes the settings pages",
              not run.is_open("settings-dialog") and not run.is_open("settings-board"))
    handles = run.js("""return [...document.querySelectorAll('[data-role="drag-habit"]')]
        .filter((h) => h.offsetParent).length;""")
    run.check("arranging turns the filter off and shows the handles",
              not run.js(filter_on) and handles > 0, f"{handles} handles")

    names = f"""return [...document.querySelectorAll(
        '.board-block[data-category="{f.category}"] .habit-name')].map((n) => n.textContent);"""
    before = run.js(names)
    handle = run.find(f'.board-block[data-category="{f.category}"] .board-habit-row:first-child [data-role="drag-habit"]')
    height = run.js("return arguments[0].closest('.board-habit-row').offsetHeight;", handle)
    (run.actions().move_to_element(handle).click_and_hold()
        .move_by_offset(0, 5).move_by_offset(0, int(height * 1.2))
        .pause(0.2).release().perform())
    time.sleep(1.2)
    after = run.js(names)
    run.check("dragging reorders the habits", after == before[::-1], f"{before} -> {after}")

    # Held near the window's bottom edge, a drag scrolls the page along; the
    # padding makes the page long enough for it.
    run.js("document.body.style.paddingBottom = '3000px';")
    handle = run.find(f'.board-block[data-category="{f.category}"] .board-habit-row:first-child [data-role="drag-habit"]')
    start = run.js("return scrollY;")
    to_edge = run.js("""
        const box = arguments[0].getBoundingClientRect();
        return innerHeight - 10 - (box.top + box.height / 2);""", handle)
    (run.actions().move_to_element(handle).click_and_hold()
        .move_by_offset(0, 5).move_by_offset(0, int(to_edge) - 5)
        .pause(1.0).release().perform())
    time.sleep(1.2)
    scrolled = run.js("return scrollY;") - start
    run.js("document.body.style.paddingBottom = '';")
    run.check("dragging near the bottom edge scrolls the page", scrolled > 100, f"{scrolled} px")
    after = run.js(names)

    run.load()
    run.check("the new order is saved", run.js(names) == after)

    # The other way round, the filter ends arranging. Reloading ended it, so
    # it is switched on again first.
    run.click("#open-settings")
    time.sleep(0.4)
    run.click('#settings-dialog [data-page="settings-board"]')
    time.sleep(0.4)
    run.click("#settings-board .switch input")
    time.sleep(0.5)
    run.driver.back()
    time.sleep(0.4)
    run.driver.back()
    time.sleep(0.6)
    run.click("#filter-open-habits")
    time.sleep(0.4)
    editing = run.js("return document.documentElement.dataset.edit;")
    run.check("the filter ends arranging", run.js(filter_on) and editing == "off", editing)
    run.click("#filter-open-habits")
    time.sleep(0.4)


def grouping(run, f):
    """Without grouping by category, the board is one list without headings."""
    headings = "return document.querySelectorAll('#board-grid .board-block-head').length;"
    run.click("#open-settings")
    time.sleep(0.4)
    run.click('#settings-dialog [data-page="settings-board"]')
    time.sleep(0.4)
    run.click("#settings-board-group")
    time.sleep(0.8)
    run.check("turning grouping off is saved",
              run.api("GET", "/api/settings")["groupByCategory"] is False)
    run.keys(Keys.ESCAPE)
    time.sleep(0.3)
    run.keys(Keys.ESCAPE)
    time.sleep(0.5)
    rows = run.js("return document.querySelectorAll('#board-grid .board-habit-row').length;")
    run.check("the board shows all habits in one list without headings",
              run.js(headings) == 0 and run.js(f"""return !!document.querySelector(
                  '.board-habit-row[data-habit="{f.check_habit}"]');""") and rows >= 2,
              f"{run.js(headings)} headings, {rows} rows")
    run.screenshot("board-ungrouped")

    run.api("PATCH", "/api/settings", {"groupByCategory": True})
    run.load()
    run.check("grouped again, the categories have their headings", run.js(headings) > 0)

    # Compact categories: a line in the category's colour instead of a heading.
    run.click("#open-settings")
    time.sleep(0.4)
    run.click('#settings-dialog [data-page="settings-board"]')
    time.sleep(0.4)
    run.click("#settings-board-compact")
    time.sleep(0.8)
    run.keys(Keys.ESCAPE)
    time.sleep(0.3)
    run.keys(Keys.ESCAPE)
    time.sleep(0.5)
    line = run.js(f"""return getComputedStyle(document.querySelector(
        '.board-block[data-category="{f.category}"]'), '::after').backgroundImage;""")
    run.check("compact categories have a line instead of a heading",
              run.js(headings) == 0 and "linear-gradient" in line, line)
    run.screenshot("board-compact")
    run.api("PATCH", "/api/settings", {"compactCategories": False})
    run.load()


def settings(run, f):
    """Settings take effect at once and are saved."""
    run.click("#open-settings")
    time.sleep(0.4)
    run.click('#settings-dialog [data-page="settings-look"]')
    time.sleep(0.4)
    theme = "light" if f.settings["theme"] != "light" else "dark"
    run.click(f'#settings-look input[name="settings-theme"][value="{theme}"] + span')
    time.sleep(0.8)
    run.check("a new theme applies at once",
              run.js("return document.documentElement.dataset.theme;") == theme)
    run.screenshot(f"settings-{theme}")

    slider = run.find("#settings-look input[type=range]")
    (run.actions().click_and_hold(slider)
        .move_by_offset(-slider.size["width"] // 2 + 5, 0).release().perform())
    time.sleep(0.8)
    saved = run.api("GET", "/api/settings")["bandOpacity"]
    run.check("a slider saves on release", saved != f.settings["bandOpacity"],
              f"{f.settings['bandOpacity']} -> {saved}")

    name_color = f"""return getComputedStyle(document.querySelector(
        '.board-habit-row[data-habit="{f.check_habit}"] .habit-name')).color;"""
    plain = run.js(name_color)
    run.click("#settings-look-color-names")
    time.sleep(0.8)
    colored = run.js(name_color)
    run.check("habit names take their colour at once, and it is saved",
              colored != plain and run.api("GET", "/api/settings")["colorNames"],
              f"{plain} -> {colored}")
    run.keys(Keys.ESCAPE)
    time.sleep(0.3)
    run.keys(Keys.ESCAPE)
    time.sleep(0.5)
    run.check("Escape closes the settings",
              not run.is_open("settings-dialog") and not run.is_open("settings-look"))

    run.click("#open-settings")
    time.sleep(0.4)
    run.click('#settings-dialog [data-page="settings-look"]')
    time.sleep(0.4)
    run.click("#settings-look-style-guide")
    time.sleep(1.5)
    run.check("the appearance page opens the style guide and closes the settings",
              run.shown("style-guide-view") and not run.is_open("settings-dialog")
              and not run.is_open("settings-look"))
    run.screenshot("style-guide")
    run.keys(Keys.ESCAPE)
    time.sleep(0.6)
    run.check("Escape returns from the style guide to the board",
              run.shown("board-view"))


def import_undo(run, f):
    """An import on the data page can be undone right there."""
    run.click("#open-settings")
    time.sleep(0.4)
    run.click('#settings-dialog [data-page="settings-data"]')
    time.sleep(0.4)
    export = {"format": "habits", "version": 2, "categories": [], "habits": [{
        "name": "Firefox import", "kind": "check", "color": "red",
        "createdAt": f"{f.today}T08:00:00Z", "entries": {}, "skipped": [],
        "schedules": [{"from": f.today, "targetValue": 1, "frequency": DAILY}]}]}
    # A file chosen as in the file picker.
    run.js("""
        const input = document.querySelector('#settings-data input[type="file"]');
        const files = new DataTransfer();
        files.items.add(new File([JSON.stringify(arguments[0])], 'habits.json',
                                 {type: 'application/json'}));
        input.files = files.files;
        input.dispatchEvent(new Event('change'));""", export)
    time.sleep(1.5)
    imported = lambda: any(h["name"] == "Firefox import"
                           for h in run.api("GET", "/api/state")["habits"])
    run.check("the import adds the habit and offers to undo it",
              imported() and run.js("return !!document.querySelector('[data-role=\"undo-import\"]');"))
    run.click('[data-role="undo-import"]')
    time.sleep(1.5)
    run.check("undoing it removes the habit",
              not imported()
              and not run.js("return !!document.querySelector('[data-role=\"undo-import\"]');"))
    run.keys(Keys.ESCAPE)
    time.sleep(0.3)
    run.keys(Keys.ESCAPE)
    time.sleep(0.5)


# ---------------------------------------------------------------- touch

def phone(run, f):
    """Touch at 500 px, the narrowest window Firefox allows."""
    layout = run.js("""return {view: document.documentElement.clientWidth,
                               page: document.documentElement.scrollWidth};""")
    run.check("no horizontal scrolling", layout["page"] <= layout["view"], str(layout))

    # A phone is narrower still: a board container of a phone's width shows
    # the tight layout, names beside the days, and a wider one more days again.
    tight = run.js("""
        const main = document.getElementById('board-view');
        const days = () => getComputedStyle(document.documentElement).getPropertyValue('--days').trim();
        main.style.maxWidth = '375px';
        await new Promise((r) => setTimeout(r, 600));
        const out = {days: days(), tight: document.documentElement.hasAttribute('data-tight'),
                     board: document.getElementById('board-grid').offsetWidth,
                     room: main.clientWidth};
        main.style.maxWidth = '';
        await new Promise((r) => setTimeout(r, 600));
        out.wider = days();
        return out;""")
    run.check("at 375 px: seven days, tight, fitting",
              tight["days"] == "7" and tight["tight"] and tight["board"] <= tight["room"],
              str(tight))
    run.check("wider again: more days", int(tight["wider"]) > 7, str(tight))
    run.screenshot("phone-board")

    run.touch(f.cell(f.check_habit))
    time.sleep(1.5)
    run.check("a tap ticks off a habit", f.done(f.check_habit))

    run.touch(f.cell(f.count_habit), hold=0.8)
    time.sleep(0.6)
    run.check("a long press opens the day dialog", run.is_open("day-editor"))
    run.check("a long press records nothing", f.value(f.count_habit) == 0)
    run.screenshot("phone-day-editor")
    run.driver.back()
    time.sleep(0.6)
    run.check("back closes the dialog", not run.is_open("day-editor"))

    run.touch(f'.board-habit-label[data-habit="{f.count_habit}"]')
    time.sleep(1.2)
    layout = run.js("""return {view: document.documentElement.clientWidth,
                               page: document.documentElement.scrollWidth};""")
    run.check("a tap on a name opens the habit view, without horizontal scrolling",
              run.shown("habit-view") and layout["page"] <= layout["view"], str(layout))
    run.touch("#habit-view .app-bar-actions > .icon-button:not([popovertarget])")
    time.sleep(0.6)
    width = run.js("return [document.getElementById('habit-editor').offsetWidth, innerWidth];")
    run.check("the editor fills the screen", abs(width[0] - width[1]) < 2, str(width))
    run.screenshot("phone-editor")
    run.driver.back()
    time.sleep(0.6)
    run.check("back closes the unchanged editor",
              not run.is_open("habit-editor") and run.shown("habit-view"))
    run.driver.back()
    time.sleep(0.8)
    run.check("back returns to the board", run.shown("board-view"))


# ---------------------------------------------------------------- main

def session(base, screenshots, test, width, height, touch=False):
    """Runs `test` in a new Firefox session with its own fixture."""
    run = Run(base, screenshots, width, height, touch)
    try:
        run.load()
        fixture = Fixture(run)
        try:
            run.load()
            test(run, fixture)
        finally:
            fixture.remove()
    finally:
        run.close()
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("url", help="the running server, e.g. http://127.0.0.1:8091")
    parser.add_argument("--screenshots", metavar="DIR", help="save screenshots in DIR")
    args = parser.parse_args()
    if args.screenshots:
        os.makedirs(args.screenshots, exist_ok=True)

    runs = [
        session(args.url, args.screenshots, desktop, 1280, 900),
        session(args.url, args.screenshots, phone, 500, 1000, touch=True),
    ]
    results = [r for run in runs for r in run.results]
    errors = [e for run in runs for e in run.errors]
    failed = [name for name, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    for error in errors:
        print(f"JavaScript error: {error}")
    return 1 if failed or errors else 0


if __name__ == "__main__":
    sys.exit(main())
