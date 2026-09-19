// Renaming in place, shared by the board and the category screen.

/**
 * Swaps an element for a text input and calls back with the typed value.
 *
 * Enter and blur both commit, Escape cancels. Enter also fires a blur, hence
 * the guard against committing twice.
 */
export function inlineInput(anchor, { value = "", placeholder = "", onCommit }) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-input";
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = 60;
  anchor.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    const typed = input.value.trim();
    input.replaceWith(anchor);
    if (commit && typed && typed !== value) onCommit(typed);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}
