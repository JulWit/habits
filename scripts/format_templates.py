# /// script
# requires-python = ">=3.10"
# ///
"""Formats the Vue templates in the frontend's JS modules.

Rewrites the `template: `...`` strings after the Vue style guide:

- A start tag with more than one attribute has one attribute per line and
  its closing bracket on a line of its own.
- Attributes follow the guide's order: v-for, v-if, id, ref and key,
  v-model, other directives, other attributes, events.
- Lines stay within 80 columns where whitespace allows it; indentation
  follows the nesting, two spaces per level.

Whitespace is only added or removed where Vue's template compiler (which
condenses whitespace) gives the same result, so the rendered page does not
change. A line may stay longer than 80 columns when nothing in it may be
broken, e.g. a long expression; move that into setup().

    uv run scripts/format_templates.py web/assets/js/*.js web/assets/js/*/*.js
    uv run scripts/format_templates.py --check web/assets/js/*.js \
        web/assets/js/*/*.js

With --check, nothing is written; the files that would change are listed
and the exit status is 1 if there are any.
"""

import argparse
import re
import sys

LIMIT = 80
INDENT = "  "
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "source", "track", "wbr",
}
TEMPLATE_START = re.compile(r"template: `")
ATTRIBUTE = re.compile(
    r"""\s*([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?""")
TAG_NAME = re.compile(r"<([A-Za-z][\w-]*)")


# ---------------------------------------------------------------- the tree

class Element:
    """An element with its attributes (as written, e.g. `:key="id"`)."""

    def __init__(self, tag, attrs, self_closing):
        self.tag = tag
        self.attrs = attrs
        self.self_closing = self_closing
        # After parsing: Gap, node, Gap, node, …, Gap.
        self.children = []

    @property
    def is_void(self):
        return self.self_closing or self.tag.lower() in VOID_TAGS


class Comment:
    def __init__(self, text):
        self.text = text


class Text:
    """Text that is not only whitespace; it may hold interpolations."""

    def __init__(self, raw):
        self.raw = raw


class Gap:
    """The whitespace between two nodes, or between a node and the edge of
    its parent."""

    def __init__(self, raw):
        self.raw = raw

    @property
    def newline(self):
        return "\n" in self.raw

    @property
    def space(self):
        return self.raw != ""


# ---------------------------------------------------------------- parsing

def parse_attributes(text):
    """Returns the attributes of a start tag's inside, and whether the tag
    closes itself."""
    attrs = []
    pos = 0
    while True:
        match = ATTRIBUTE.match(text, pos)
        if not match or match.end() == pos:
            break
        name, value = match.group(1), match.group(2)
        attrs.append(name if value is None else f"{name}={value}")
        pos = match.end()
    rest = text[pos:].strip()
    if rest not in ("", "/"):
        raise ValueError(f"cannot read the attributes {text!r}")
    return attrs, rest == "/"


def tokens(template):
    """Yields ("start", tag, attrs, self_closing), ("end", tag),
    ("comment", text) and ("text", raw) for a template."""
    i, n = 0, len(template)
    text = ""
    while i < n:
        if template.startswith("{{", i):
            # An interpolation may hold < and >.
            end = template.index("}}", i) + 2
            text += template[i:end]
            i = end
            continue
        is_tag = template.startswith("<!--", i) or \
            template.startswith("</", i) or \
            (template[i] == "<" and i + 1 < n and template[i + 1].isalpha())
        if not is_tag:
            text += template[i]
            i += 1
            continue
        if text:
            yield ("text", text)
            text = ""
        if template.startswith("<!--", i):
            end = template.index("-->", i) + 3
            yield ("comment", template[i:end])
            i = end
        elif template.startswith("</", i):
            end = template.index(">", i)
            yield ("end", template[i + 2:end].strip())
            i = end + 1
        else:
            match = TAG_NAME.match(template, i)
            end = closing_bracket(template, match.end())
            attrs, self_closing = parse_attributes(template[match.end():end])
            yield ("start", match.group(1), attrs, self_closing)
            i = end + 1
    if text:
        yield ("text", text)


def closing_bracket(template, pos):
    """Returns the position of the > that ends the start tag, skipping
    quoted attribute values."""
    quote = None
    while True:
        char = template[pos]
        if quote:
            if char == quote:
                quote = None
        elif char in "\"'":
            quote = char
        elif char == ">":
            return pos
        pos += 1


def parse(template):
    """Returns the root element of a template."""
    root = Element("#root", [], False)
    stack = [root]
    for token in tokens(template):
        parent = stack[-1]
        if token[0] == "start":
            element = Element(token[1], token[2], token[3])
            parent.children.append(element)
            if not element.is_void:
                stack.append(element)
        elif token[0] == "end":
            element = stack.pop()
            if element.tag != token[1]:
                raise ValueError(f"</{token[1]}> closes <{element.tag}>")
        elif token[0] == "comment":
            parent.children.append(Comment(token[1]))
        else:
            parent.children.append(token[1])
    if len(stack) != 1:
        raise ValueError(f"<{stack[-1].tag}> is not closed")
    split_whitespace(root)
    return root


def split_whitespace(element):
    """Turns the raw text among the children into Gap and Text items, so
    that gaps and nodes alternate."""
    items = [Gap("")]
    for child in element.children:
        if isinstance(child, str):
            core = child.strip()
            if not core:
                items[-1] = Gap(items[-1].raw + child)
                continue
            lead = child[:len(child) - len(child.lstrip())]
            trail = child[len(child.rstrip()):]
            items[-1] = Gap(items[-1].raw + lead)
            items += [Text(core), Gap(trail)]
        else:
            if isinstance(child, Element):
                split_whitespace(child)
            items += [child, Gap("")]
    element.children = items


# ---------------------------------------------------------------- rules

def is_tag_node(node):
    return isinstance(node, (Element, Comment))


def may_break(prev, gap, following):
    """Reports whether `gap` may become a line break without changing what
    Vue renders. `prev` and `following` are None at the parent's edges.

    Vue removes whitespace at the edges of an element and whitespace with a
    newline between two elements; any other whitespace becomes one space.
    """
    if gap.newline:
        return True
    if prev is None or following is None:
        other = following if prev is None else prev
        if other is None or is_tag_node(other):
            return True
        # Whitespace next to an interpolation is a node of its own, which is
        # removed at the edge.
        if prev is None:
            return other.raw.startswith("{{") or gap.space
        return other.raw.endswith("}}") or gap.space
    if is_tag_node(prev) and is_tag_node(following):
        # A space between elements is kept as one space; a break is not.
        return not gap.space
    # Next to text, a break is the same as an existing space.
    return gap.space


def attribute_rank(attr):
    """The attribute's place in the Vue style guide's order."""
    name = attr.split("=", 1)[0]
    if name in ("is", ":is"):
        return 1
    if name == "v-for":
        return 2
    if name in ("v-if", "v-else-if", "v-else", "v-show", "v-cloak"):
        return 3
    if name in ("v-pre", "v-once"):
        return 4
    if name == "id":
        return 5
    if name in ("ref", "key", ":key", ":ref"):
        return 6
    if name.startswith(("v-slot", "#")):
        return 7
    if name.startswith("v-model"):
        return 8
    if name.startswith(("@", "v-on")):
        return 11
    if name in ("v-html", "v-text"):
        return 12
    # Other directives, such as v-tooltip, before the other attributes.
    if name.startswith("v-") and not name.startswith("v-bind"):
        return 9
    return 10


def ordered(attrs):
    return sorted(attrs, key=attribute_rank)


# ---------------------------------------------------------------- printing

def start_tag(element, indent):
    """Lines of a start tag: one line with at most one attribute, else one
    attribute per line."""
    close = "/>" if element.self_closing else ">"
    attrs = ordered(element.attrs)
    line = f"<{element.tag}" + "".join(" " + a for a in attrs) + close
    if len(attrs) <= 1 and len(indent) + len(line) <= LIMIT:
        return [indent + line]
    return ([indent + f"<{element.tag}"] +
            [indent + INDENT + a for a in attrs] + [indent + close])


def one_line(node):
    """The node on a single line, or None if it spans several."""
    if isinstance(node, Text):
        return None if "\n" in node.raw else node.raw
    if isinstance(node, Comment):
        return None if "\n" in node.text else node.text
    if len(node.attrs) > 1:
        return None
    line = f"<{node.tag}" + "".join(" " + a for a in node.attrs) + \
        ("/>" if node.self_closing else ">")
    if node.is_void:
        return line
    for item in node.children:
        if isinstance(item, Gap):
            if item.newline:
                return None
            line += " " if item.space else ""
            continue
        inner = one_line(item)
        if inner is None:
            return None
        line += inner
    return line + f"</{node.tag}>"


def words(text):
    """Splits text at whitespace outside interpolations into (word,
    whitespace before it) pairs."""
    pairs = []
    raw = text.raw
    i, word, before = 0, "", ""
    while i < len(raw):
        if raw.startswith("{{", i):
            end = raw.index("}}", i) + 2
            word += raw[i:end]
            i = end
        elif raw[i].isspace():
            end = i
            while end < len(raw) and raw[end].isspace():
                end += 1
            pairs.append((word, before))
            word, before = "", raw[i:end]
            i = end
        else:
            word += raw[i]
            i += 1
    pairs.append((word, before))
    return pairs


def render(node, indent):
    """Lines of a node at the given indentation."""
    if isinstance(node, Comment):
        return render_comment(node, indent)
    if isinstance(node, Text):
        return [indent + node.raw]
    line = one_line(node)
    if line is not None and len(indent) + len(line) <= LIMIT:
        return [indent + line]
    lines = start_tag(node, indent)
    if node.is_void:
        return lines
    return render_children(node, indent, lines)


def render_comment(comment, indent):
    """Lines of a comment, wrapped at 80 columns; continuation lines line up
    with the text after '<!-- '."""
    text = comment.text[4:-3].split()
    line = "<!-- " + " ".join(text) + " -->"
    if "\n" not in comment.text and len(indent) + len(comment.text) <= LIMIT:
        return [indent + comment.text]
    if len(indent) + len(line) <= LIMIT:
        return [indent + line]
    lines, current = [], indent + "<!--"
    for word in text:
        if len(current) + 1 + len(word) > LIMIT and \
                current != indent + "<!--":
            lines.append(current)
            current = indent + "     " + word
        else:
            current += " " + word
    if len(current) + len(" -->") > LIMIT:
        head, _, last = current.rpartition(" ")
        lines.append(head)
        current = indent + "     " + last
    lines.append(current + " -->")
    return lines


class Unit:
    """A child node or a word of a text, with the whitespace before it."""

    def __init__(self, lines, gap, breakable, is_node):
        self.lines = lines
        self.gap = gap
        self.breakable = breakable
        self.is_node = is_node


def render_children(element, indent, lines):
    """Returns `lines` (the element's start tag) followed by its children
    and its end tag. A child goes on a line of its own where it did before,
    where it or its neighbour spans several lines, and where it would not
    fit; but only where the whitespace allows a break."""
    inner = indent + INDENT
    nodes = element.children[1::2]
    gaps = element.children[0::2]

    def breakable(k):
        prev = nodes[k - 1] if k > 0 else None
        following = nodes[k] if k < len(nodes) else None
        return may_break(prev, gaps[k], following)

    units = []
    for k, node in enumerate(nodes):
        if not isinstance(node, Text):
            units.append(Unit(render(node, inner), gaps[k], breakable(k),
                              True))
            continue
        for w, (word, before) in enumerate(words(node)):
            if w == 0:
                units.append(Unit([inner + word], gaps[k], breakable(k),
                                  False))
            else:
                units.append(Unit([inner + word], Gap(before), True, False))
    end_gap = gaps[len(nodes)]
    end_breakable = breakable(len(nodes))
    end_tag = f"</{element.tag}>"

    def chain_width(i):
        """Width of unit i and the units that cannot be separated from it,
        up to the first unit that spans several lines."""
        width = len(units[i].lines[0].lstrip())
        j = i + 1
        while (len(units[j - 1].lines) == 1 and j < len(units) and
               not units[j].breakable):
            width += (1 if units[j].gap.space else 0) + \
                len(units[j].lines[0].lstrip())
            j += 1
        if j == len(units) and len(units[j - 1].lines) == 1 and \
                not end_breakable:
            width += len(end_tag)
        return width

    out = list(lines)
    multiline_head = len(lines) > 1
    prev_multiline = False
    for i, unit in enumerate(units):
        joiner = " " if unit.gap.space else ""
        fits = len(out[-1]) + len(joiner) + chain_width(i) <= LIMIT
        wants_break = (unit.gap.newline or len(unit.lines) > 1 or
                       prev_multiline or not fits or
                       (i == 0 and multiline_head))
        if wants_break and unit.breakable:
            out += unit.lines
        else:
            out[-1] += joiner + unit.lines[0].lstrip()
            out += unit.lines[1:]
        prev_multiline = len(unit.lines) > 1

    wants_break = units and (end_gap.newline or multiline_head or
                             len(out) > len(lines) or
                             len(out[-1]) + len(end_tag) > LIMIT)
    if wants_break and end_breakable:
        out.append(indent + end_tag)
    else:
        out[-1] += (" " if end_gap.space else "") + end_tag
    return out


def format_template(template):
    """Returns the formatted template; it starts with a newline, and its
    first line gives the indentation."""
    indent = re.match(r"\n( *)", template).group(1)
    root = parse(template)
    nodes = root.children[1::2]
    gaps = root.children[0::2]
    out = []
    for k, node in enumerate(nodes):
        lines = render(node, indent)
        prev = nodes[k - 1] if k else None
        if out and not may_break(prev, gaps[k], node):
            out[-1] += (" " if gaps[k].space else "") + lines[0].lstrip()
            out += lines[1:]
        else:
            out += lines
    return "\n" + "\n".join(out)


def format_file(path):
    """Returns the file's content with its templates formatted, and the
    content as it was. Line endings are kept."""
    with open(path, encoding="utf-8", newline="") as f:
        original = f.read()
    source = original.replace("\r\n", "\n")
    pieces, pos = [], 0
    for match in TEMPLATE_START.finditer(source):
        end = source.index("`", match.end())
        pieces += [source[pos:match.end()],
                   format_template(source[match.end():end])]
        pos = end
    pieces.append(source[pos:])
    formatted = "".join(pieces)
    if "\r\n" in original:
        formatted = formatted.replace("\n", "\r\n")
    return formatted, original


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("files", nargs="+")
    parser.add_argument("--check", action="store_true",
                        help="only list the files that would change")
    args = parser.parse_args()
    changed = []
    for path in args.files:
        formatted, original = format_file(path)
        if formatted == original:
            continue
        changed.append(path)
        if not args.check:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(formatted)
    for path in changed:
        print(("would change " if args.check else "formatted ") + path)
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    sys.exit(main())
