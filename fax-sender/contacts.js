const fallback = "Couldn't load RingCentral contacts. Enter a fax number manually.";

export function filterContacts(contacts, query) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return contacts.filter(contact => {
    const searchable = [contact.name, contact.company, contact.location, ...contact.faxNumbers.map(fax => fax.number)].join(" ").toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}

export class ContactPicker {
  constructor({ search, results, message, reload, numberInput, batch, onSelect }) {
    Object.assign(this, { search, results, message, reload, numberInput, batch, onSelect });
    this.contacts = null;
    this.loading = false;
    this.error = "";
    search.addEventListener("focus", () => this.load());
    search.addEventListener("input", () => { this.render(); this.load(); });
    // Searching must not implicitly submit the surrounding fax form.
    search.addEventListener("keydown", event => {
      if (event.key === "Enter") event.preventDefault();
      if (event.key === "ArrowDown") {
        const first = this.results.querySelector("button");
        if (first) { event.preventDefault(); first.focus(); }
      }
    });
    reload.addEventListener("click", () => this.load(true));
    this.render();
  }

  get locked() { return this.batch.busy || Boolean(this.batch.destination); }

  async load(force = false) {
    if (this.locked || this.loading || (!force && (this.contacts !== null || this.error))) return;
    this.loading = true;
    this.error = "";
    this.render();
    try {
      const response = await globalThis.fetch("/api/ringcentral-contacts", { cache: "no-store", signal: AbortSignal.timeout(50_000) });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.contacts)) {
        throw new Error(response.status === 403 ? `${fallback} Ask your administrator to enable ReadContacts.` : fallback);
      }
      this.contacts = data.contacts;
    } catch (error) {
      this.error = error.message === `${fallback} Ask your administrator to enable ReadContacts.` ? error.message : fallback;
      this.contacts = null;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  select(contact, fax) {
    if (this.locked || !/^\+[1-9]\d{7,14}$/.test(fax.number)) return;
    // The existing input remains the sole editable destination. No second fax state.
    this.numberInput.value = fax.number;
    this.search.value = "";
    this.onSelect();
    this.numberInput.focus();
  }

  render() {
    this.search.disabled = this.locked;
    this.reload.disabled = this.locked || this.loading;
    this.reload.hidden = this.contacts === null && !this.error;
    this.reload.textContent = this.error ? "Try loading contacts again" : "Refresh contacts";
    this.results.replaceChildren();
    this.message.textContent = this.locked ? "Contact selection is locked for this batch. Clear All after submission to choose another destination." :
      this.loading ? "Loading RingCentral contacts… You can still enter a fax number manually." :
      this.error || (this.contacts === null ? "Search your RingCentral personal contacts, or enter a fax number below." : "Type a name, company, or city. Select the fax number you want to use.");
    if (this.locked || this.loading || !this.contacts || !this.search.value.trim()) return;
    const matches = filterContacts(this.contacts, this.search.value);
    this.message.textContent = `${matches.length} matching contacts.${matches.length > 30 ? " Showing the first 30; refine your search." : ""}`;
    for (const contact of matches.slice(0, 30)) {
      const row = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = contact.name;
      const detail = document.createElement("p");
      detail.textContent = [contact.company, contact.location].filter(Boolean).join(" · ");
      row.append(heading, detail);
      for (const fax of contact.faxNumbers) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-btn";
        button.textContent = `${fax.label}: ${fax.number}`;
        button.setAttribute("aria-label", `${contact.name}, ${fax.label}, ${fax.number}`);
        button.addEventListener("click", () => this.select(contact, fax));
        row.append(button);
      }
      if (!contact.faxNumbers.length) {
        const note = document.createElement("p");
        note.textContent = "No usable fax number saved. Enter a verified fax number manually.";
        row.append(note);
      }
      this.results.append(row);
    }
  }
}
