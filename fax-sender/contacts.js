import { normalizeFaxNumber, validFaxNumber } from "./batch.js";

const fallback = "RingCentral contacts unavailable. You can still enter a fax number.";

export function formatFaxNumber(number) {
  return /^\+1\d{10}$/.test(number)
    ? `(${number.slice(2, 5)}) ${number.slice(5, 8)}-${number.slice(8)}` : number;
}

export function manualFaxNumber(value) {
  let number = normalizeFaxNumber(value);
  // Local manual-entry convenience only. The batch/API normalization is unchanged.
  if (/^\d{10}$/.test(number)) number = `+1${number}`;
  else if (/^1\d{10}$/.test(number)) number = `+${number}`;
  return validFaxNumber(number) ? number : "";
}

export function filterContacts(contacts, query) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return contacts.filter(contact => {
    const searchable = [contact.name, contact.company, contact.location, ...contact.faxNumbers.map(fax => fax.number)].join(" ").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}

export class ContactPicker {
  constructor({ root, dropdown, clear, search, results, message, reload, numberInput, batch, onSelect }) {
    Object.assign(this, { root, dropdown, clearButton: clear, search, results, message, reload, numberInput, batch, onSelect });
    this.contacts = null;
    this.loading = false;
    this.error = "";
    this.open = false;
    this.selectedName = ""; // Display metadata only; numberInput is the sole destination value.
    this.saving = false;
    this.saveOpen = false;
    this.saveStatus = "";
    this.saveUI = Object.fromEntries(["offerSaveContact", "saveContactPanel", "contactName", "saveContactNumber", "saveContact", "cancelSaveContact", "saveContactStatus"].map(id => [id, document.getElementById(id)]));
    this.saveUI.offerSaveContact.addEventListener("click", () => {
      this.saveOpen = true; this.saveStatus = ""; this.render(); this.saveUI.contactName.focus();
    });
    this.saveUI.cancelSaveContact.addEventListener("click", () => { this.saveOpen = false; this.render(); });
    this.saveUI.saveContact.addEventListener("click", () => this.saveContact());
    this.saveUI.contactName.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.saveContact(); }
    });
    search.addEventListener("focus", () => {
      if (!this.numberInput.value) this.open = true;
      this.render();
      this.load();
    });
    search.addEventListener("input", () => {
      if (this.locked || this.numberInput.value) { this.render(); return; }
      this.open = true;
      this.render();
      this.load();
    });
    search.addEventListener("keydown", event => {
      if (event.key === "Enter") event.preventDefault(); // Never implicitly submit the fax form.
      if (event.key === "ArrowDown" && !this.numberInput.value && !this.locked) {
        event.preventDefault(); this.open = true; this.render();
        this.results.querySelector("button")?.focus();
      }
    });
    root.addEventListener("keydown", event => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault(); this.search.focus(); this.close();
      }
      const buttons = [...this.results.querySelectorAll("button")];
      const index = buttons.indexOf(document.activeElement);
      if (index >= 0 && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const next = index + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0) this.search.focus(); else buttons[Math.min(next, buttons.length - 1)]?.focus();
      }
    });
    document.addEventListener("pointerdown", event => { if (!root.contains(event.target)) this.close(); });
    root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget)) this.close(); });
    reload.addEventListener("click", () => this.load(true));
    clear.addEventListener("click", () => { this.clear(); if (!this.locked) this.search.focus(); });
    this.render();
  }

  get locked() { return this.saving || this.batch.busy || Boolean(this.batch.destination); }

  existingContact(number) {
    return this.contacts?.find(contact => contact.faxNumbers.some(fax => normalizeFaxNumber(fax.number) === number));
  }

  async saveContact() {
    if (this.locked) return;
    const number = manualFaxNumber(this.numberInput.value);
    const name = this.saveUI.contactName.value.trim();
    if (!number || !this.contacts || this.existingContact(number)) return;
    if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) {
      this.saveStatus = "Enter a contact name of 1–60 characters."; this.render(); return;
    }
    this.saving = true;
    this.saveStatus = "Saving contact…";
    this.render();
    this.onSelect();
    try {
      const response = await globalThis.fetch("/api/ringcentral-contacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, faxNumber: number }), signal: AbortSignal.timeout(50_000)
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.contact?.faxNumbers?.some(fax => fax.number === number)) {
        throw new Error(data.error || "Contact save could not be confirmed. Refresh contacts before retrying.");
      }
      this.contacts = [...this.contacts.filter(contact => contact.id !== data.contact.id), data.contact];
      this.error = "";
      if (this.numberInput.value === number) this.selectedName = data.contact.name;
      this.saveOpen = false;
      this.saveUI.contactName.value = "";
      this.saveStatus = data.existing ? "This fax number is already saved in RingCentral Contacts." : "Contact saved to RingCentral.";
    } catch (error) {
      this.saveStatus = error.name === "Error" ? error.message : "Contact save could not be confirmed. Refresh contacts before retrying. Manual faxing is still available.";
    } finally { this.saving = false; this.render(); this.onSelect(); }
  }

  close() {
    this.open = false;
    this.dropdown.hidden = true;
    this.search.setAttribute("aria-expanded", "false");
  }

  clear() {
    if (this.locked) return;
    this.numberInput.value = "";
    this.selectedName = "";
    this.saveOpen = false;
    this.saveStatus = "";
    this.saveUI.contactName.value = "";
    this.search.value = "";
    this.close();
    this.onSelect();
  }

  async load(force = false) {
    if (this.locked || this.loading || (!force && (this.contacts !== null || this.error))) return;
    this.loading = true;
    this.error = "";
    this.render();
    try {
      const response = await globalThis.fetch("/api/ringcentral-contacts", { cache: "no-store", signal: AbortSignal.timeout(50_000) });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.contacts)) throw new Error("Contacts unavailable");
      this.contacts = data.contacts;
    } catch {
      this.error = fallback;
      this.contacts = null;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  select(contact, fax) {
    if (this.locked || !validFaxNumber(fax.number)) return;
    this.numberInput.value = fax.number;
    this.selectedName = contact?.name || "";
    this.close();
    this.onSelect();
    this.search.focus();
  }

  choice(title, subtitle, contact, fax) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "destination-option";
    const name = document.createElement("span");
    name.className = "destination-option-name";
    name.textContent = title;
    const number = document.createElement("span");
    number.className = "destination-option-number";
    number.textContent = subtitle;
    button.append(name, number);
    button.addEventListener("click", () => this.select(contact, fax));
    return button;
  }

  render() {
    const number = manualFaxNumber(this.numberInput.value);
    const canSave = Boolean(number && this.contacts && !this.loading && !this.existingContact(number));
    this.saveUI.offerSaveContact.hidden = !canSave || this.saveOpen || this.locked;
    this.saveUI.saveContactPanel.hidden = !canSave || !this.saveOpen || (this.locked && !this.saving);
    this.saveUI.saveContactNumber.textContent = formatFaxNumber(number);
    this.saveUI.saveContact.disabled = this.locked;
    this.saveUI.cancelSaveContact.disabled = this.saving;
    this.saveUI.contactName.disabled = this.saving;
    this.saveUI.saveContactStatus.textContent = this.saveStatus;
    this.saveUI.saveContactStatus.hidden = !this.saveStatus;
    const selected = Boolean(this.numberInput.value);
    if (this.locked || selected) this.open = false;
    this.search.disabled = this.locked;
    this.search.readOnly = selected;
    if (selected) this.search.value = [this.selectedName, formatFaxNumber(this.numberInput.value)].filter(Boolean).join(" • ");
    this.search.title = selected ? this.search.value : "";
    this.clearButton.hidden = !selected && !this.search.value;
    this.clearButton.disabled = this.locked;
    this.reload.disabled = this.locked || this.loading;
    this.reload.classList.toggle("is-loading", this.loading);
    this.reload.setAttribute("aria-busy", String(this.loading));
    this.message.textContent = this.error;
    this.message.hidden = !this.error;
    this.results.replaceChildren();
    const query = this.search.value.trim();
    const visible = this.open && !this.locked && !selected && Boolean(query);
    this.dropdown.hidden = !visible;
    this.search.setAttribute("aria-expanded", String(visible));
    if (!visible) return;
    const manual = manualFaxNumber(query);
    if (manual) {
      const row = document.createElement("li");
      row.append(this.choice("Use fax number", formatFaxNumber(manual), null, { number: manual }));
      this.results.append(row);
    }
    const matches = filterContacts(this.contacts || [], query);
    for (const contact of matches.slice(0, 30)) {
      const row = document.createElement("li");
      if (contact.faxNumbers.length === 1) {
        const fax = contact.faxNumbers[0];
        row.append(this.choice(contact.name, formatFaxNumber(fax.number), contact, fax));
      } else {
        const heading = document.createElement("strong");
        heading.className = "destination-group-name";
        heading.textContent = contact.name;
        row.append(heading);
        for (const fax of contact.faxNumbers) {
          const choice = this.choice(fax.label, formatFaxNumber(fax.number), contact, fax);
          choice.classList.add("destination-subchoice");
          choice.setAttribute("aria-label", `${contact.name}, ${fax.label}, ${formatFaxNumber(fax.number)}`);
          row.append(choice);
        }
        if (!contact.faxNumbers.length) {
          const note = document.createElement("p");
          note.className = "destination-empty";
          note.textContent = "No usable fax number saved.";
          row.append(note);
        }
      }
      this.results.append(row);
    }
    if (this.loading || (!matches.length && !manual) || matches.length > 30) {
      const note = document.createElement("li");
      note.className = "destination-empty";
      note.textContent = this.loading ? "Loading contacts… Manual numbers are available now." :
        matches.length > 30 ? "Showing the first 30 contacts. Refine your search for more." :
        this.error ? "Enter a fax number, including country code for international numbers." : "No matches. Enter a fax number or try another name.";
      this.results.append(note);
    }
  }
}
