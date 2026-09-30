# /// script
# requires-python = ">=3.10"
# ///
"""Formats the stylesheets after the Google HTML/CSS style guide.

https://google.github.io/styleguide/htmlcssguide.html#CSS_Formatting_Rules

- Every selector and every declaration starts a new line; a rule is never
  written on one line.
- Declarations are in alphabetical order, vendor prefixes ignored. A comment
  before a declaration moves with it. Custom properties come first and keep
  their order: the design tokens are grouped by meaning (the palette in the
  order of the colour wheel, a comment above each group), which sorting
  would scatter. They never override other declarations, so their place does
  not change what a rule does.
- Rules are separated by a blank line.
- Strings use single quotes, url() none, and numbers between -1 and 1 have
  their leading 0.

Sorting never moves a declaration past another one that sets the same
property, e.g. `padding-left` past `padding`, as the later one wins. Such a
rule is reported instead; write it so that the alphabetical order is the
intended one.

    uv run scripts/format_css.py web/assets/css/*.css
    uv run scripts/format_css.py --check web/assets/css/*.css

With --check, nothing is written; the files that would change are listed
and the exit status is 1 if there are any.
"""

import argparse
import re
import sys

INDENT = "  "
VENDOR = re.compile(r"^-(webkit|moz|ms|o)-")

# Shorthands and the properties they also set, beyond those that start with
# their name (padding sets padding-left, font sets font-size, …).
ALSO_SETS = {
    "font": {"line-height"},
    "inset": {"top", "right", "bottom", "left"},
    "inset-inline": {"left", "right"},
    "inset-block": {"top", "bottom"},
    "margin-inline": {"margin-left", "margin-right"},
    "margin-block": {"margin-top", "margin-bottom"},
    "padding-inline": {"padding-left", "padding-right"},
    "padding-block": {"padding-top", "padding-bottom"},
    "place-items": {"align-items", "justify-items"},
    "place-content": {"align-content", "justify-content"},
    "place-self": {"align-self", "justify-self"},
    "gap": {"row-gap", "column-gap"},
    "grid-area": {"grid-row", "grid-row-start", "grid-row-end", "grid-column",
                  "grid-column-start", "grid-column-end"},
    "flex-flow": {"flex-direction", "flex-wrap"},
    "border-width": {"border-top-width", "border-right-width",
                     "border-bottom-width", "border-left-width"},
    "border-color": {"border-top-color", "border-right-color",
                     "border-bottom-color", "border-left-color"},
    "border-style": {"border-top-style", "border-right-style",
                     "border-bottom-style", "border-left-style"},
}

# Properties that start with a shorthand's name but are not set by it.
NOT_SET_BY = {
    "border": ("border-radius", "border-top-left-radius",
               "border-top-right-radius", "border-bottom-left-radius",
               "border-bottom-right-radius", "border-collapse",
               "border-spacing"),
    "flex": ("flex-direction", "flex-wrap", "flex-flow"),
    "grid": ("grid-area", "grid-row", "grid-row-start", "grid-row-end",
             "grid-column", "grid-column-start", "grid-column-end"),
    "outline": ("outline-offset",),
    "overflow": ("overflow-wrap",),
}


# ---------------------------------------------------------------- the tree

class Comment:
    """A comment, with the column its text was written at."""

    def __init__(self, text, column, blank):
        self.text = text
        self.column = column
        self.blank = blank


class Declaration:
    """A declaration, or an at-rule statement such as @import."""

    def __init__(self, text, blank):
        self.text = text.strip()
        self.blank = blank
        # Comments written right before it, which move with it.
        self.comments = []

    @property
    def name(self):
        return self.text.split(":", 1)[0].strip().lower()

    @property
    def sort_key(self):
        return VENDOR.sub("", self.name)


class Block:
    """A rule or an at-rule with a block: its prelude and its items."""

    def __init__(self, prelude, items, blank):
        self.prelude = prelude.strip()
        self.items = items
        self.blank = blank


# ---------------------------------------------------------------- parsing

def scan(css, i):
    """Returns the position of the next `;`, `{` or `}` at nesting depth 0
    from i, skipping strings, comments and parentheses."""
    depth = 0
    while i < len(css):
        c = css[i]
        if c in "\"'":
            i = css.index(c, i + 1)
        elif css.startswith("/*", i):
            i = css.index("*/", i) + 1
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif depth == 0 and c in ";{}":
            return i
        i += 1
    return i


def column(css, i):
    """Returns the column of position i."""
    return i - (css.rfind("\n", 0, i) + 1)


def parse(css, i=0):
    """Parses the items of a block (or of the file) from i. Returns them and
    the position after the block's `}`."""
    items = []
    while True:
        start = i
        while i < len(css) and css[i].isspace():
            i += 1
        blank = max(0, css.count("\n", start, i) - 1)
        if i >= len(css):
            return items, i
        if css[i] == "}":
            return items, i + 1
        if css.startswith("/*", i):
            end = css.index("*/", i) + 2
            items.append(Comment(css[i:end], column(css, i), blank))
            i = end
            continue
        end = scan(css, i)
        if end < len(css) and css[end] == "{":
            prelude = css[i:end]
            children, i = parse(css, end + 1)
            items.append(Block(prelude, children, blank))
        else:
            items.append(Declaration(css[i:end], blank))
            i = end + 1 if end < len(css) and css[end] == ";" else end


# ---------------------------------------------------------------- values

def outside_strings(text, fn):
    """Applies fn to the parts of text outside strings and url()."""
    parts = re.split(r"""("[^"]*"|'[^']*'|url\([^)]*\))""", text)
    return "".join(p if i % 2 else fn(p) for i, p in enumerate(parts))


def quotes(text):
    """Writes strings in single quotes and url() without quotes."""
    text = re.sub(r"""url\((["'])([^"'\s()]*)\1\)""", r"url(\2)", text)
    return re.sub(r'"([^"\']*)"', r"'\1'", text)


def leading_zeros(text):
    """Puts a 0 before numbers between -1 and 1."""
    return outside_strings(
        text, lambda p: re.sub(r"(?<![\w.)\]])\.(\d)", r"0.\1", p))


def selectors(prelude):
    """Splits a selector list at its top-level commas."""
    parts, depth, start = [], 0, 0
    for i, c in enumerate(prelude):
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(prelude[start:i])
            start = i + 1
    parts.append(prelude[start:])
    return [" ".join(p.split()) for p in parts]


# ---------------------------------------------------------------- sorting

def sets(a, b):
    """Reports whether setting property a also sets property b."""
    if b in NOT_SET_BY.get(a, ()):
        return False
    return b.startswith(a + "-") or b in ALSO_SETS.get(a, ())


def overlap(a, b):
    """Reports whether two properties set a property in common. Custom
    properties are independent of each other."""
    if a.startswith("--") or b.startswith("--"):
        return a == b
    return a == b or sets(a, b) or sets(b, a)


def sort_declarations(run, where, problems):
    """Returns a run of declarations in order: custom properties as written,
    then the others alphabetically. If that would move one past another that
    sets the same property, the run is kept as it is and reported."""
    custom = [d for d in run if d.name.startswith("--")]
    others = [d for d in run if not d.name.startswith("--")]
    ordered = custom + sorted(others, key=lambda d: d.sort_key)
    position = {id(d): i for i, d in enumerate(ordered)}
    for i, a in enumerate(run):
        for b in run[i + 1:]:
            if (position[id(a)] > position[id(b)] and
                    overlap(a.sort_key, b.sort_key)):
                problems.append(f"{where}: {a.name} before {b.name}")
                return run
    return ordered


def sort_items(items, where, problems):
    """Sorts each run of declarations among the items; a comment before a
    declaration moves with it."""
    out, run, pending = [], [], []
    for item in items:
        if isinstance(item, Comment):
            pending.append(item)
        elif isinstance(item, Declaration):
            item.comments, pending = pending, []
            run.append(item)
        else:
            out += sort_declarations(run, where, problems) + pending
            out.append(item)
            run, pending = [], []
    return out + sort_declarations(run, where, problems) + pending


# ---------------------------------------------------------------- printing

def print_comment(comment, indent):
    """Prints a comment at `indent`, keeping the relative indentation of its
    continuation lines."""
    lines = comment.text.split("\n")
    shift = len(indent) - comment.column
    out = [indent + lines[0]]
    for line in lines[1:]:
        if shift >= 0:
            out.append(" " * shift + line if line.strip() else "")
        else:
            out.append(line[min(-shift, len(line) - len(line.lstrip())):])
    return out


def print_declaration(decl, indent):
    """Prints a declaration as `name: value;`, its continuation lines
    indented four spaces."""
    if ":" not in decl.text or decl.text.startswith("@"):
        return [indent + quotes(decl.text) + ";"]
    name, value = decl.text.split(":", 1)
    lines = [line.strip() for line in value.strip().split("\n")]
    value = ("\n" + indent + INDENT * 2).join(lines)
    value = leading_zeros(quotes(value))
    return [f"{indent}{name.strip().lower()}: {value};"]


def print_items(items, depth, where, problems):
    """Prints the items of a block at nesting depth `depth`."""
    indent = INDENT * depth
    out, previous = [], None
    for item in sort_items(items, where, problems):
        comments = getattr(item, "comments", [])
        if previous is not None:
            blank = (item.comments[0] if comments else item).blank
            if isinstance(item, (Block, Comment)) and isinstance(
                    previous, Block):
                blank = max(blank, 1)
            if isinstance(item, Declaration) and not isinstance(
                    previous, Block):
                blank = 0
            out += [""] * min(blank, 2)
        for comment in comments:
            out += print_comment(comment, indent)
        if isinstance(item, Comment):
            out += print_comment(item, indent)
        elif isinstance(item, Declaration):
            out += print_declaration(item, indent)
        else:
            out += print_block(item, depth, problems)
        previous = item
    return out


def print_block(block, depth, problems):
    """Prints a rule with one selector per line, or an at-rule."""
    indent = INDENT * depth
    prelude = leading_zeros(quotes(block.prelude))
    if prelude.startswith("@"):
        head = [indent + " ".join(prelude.split()) + " {"]
    else:
        parts = selectors(prelude)
        head = [indent + p + "," for p in parts[:-1]]
        head.append(indent + parts[-1] + " {")
    body = print_items(block.items, depth + 1, " ".join(prelude.split()),
                       problems)
    return head + body + [indent + "}"]


def format_css(css):
    """Returns the stylesheet formatted, and the rules whose declarations
    could not be sorted."""
    items, _ = parse(css)
    problems = []
    lines = print_items(items, 0, "(top level)", problems)
    return "\n".join(lines) + "\n", problems


def format_file(path):
    """Returns the file's content formatted, the content as it was and the
    problems found. Line endings are kept."""
    with open(path, encoding="utf-8", newline="") as f:
        original = f.read()
    formatted, problems = format_css(original.replace("\r\n", "\n"))
    if "\r\n" in original:
        formatted = formatted.replace("\n", "\r\n")
    return formatted, original, problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("files", nargs="+")
    parser.add_argument("--check", action="store_true",
                        help="only list the files that would change")
    args = parser.parse_args()
    changed, problems = [], []
    for path in args.files:
        formatted, original, found = format_file(path)
        problems += [f"{path}: {p}" for p in found]
        if formatted == original:
            continue
        changed.append(path)
        if not args.check:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(formatted)
    for path in changed:
        print(("would change " if args.check else "formatted ") + path)
    for problem in problems:
        print("not sorted, sets the same property: " + problem)
    return 1 if (args.check and changed) or problems else 0


if __name__ == "__main__":
    sys.exit(main())
