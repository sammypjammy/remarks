import assert from "node:assert/strict";

export async function checkReview({ evaluate, capture, width }) {
  const text = "PERSONAL INFORMATION\nFirst Name: Synthetic\nLast Name: Example\nSocial Security Number: 900-00-0742\nEmail: synthetic@example.test\nEMPLOYMENT INFORMATION\nCurrently working: Yes\nOTHER NAMES\nUsed other names in medical records: Yes\nMARRIAGE INFORMATION\nMarital Status: Separated\nFINANCIAL SUPPORT\nVeteran Benefits - Receive Veteran Benefits: Yes\nMEDICAL PROBLEMS\n" + Array.from({ length: 11 }, (_, i) => `Problem ${i + 1}: Synthetic condition`).join("\n") + "\nWORK HISTORY\nMost Recent Job\nStart Date: 2025-02-01\nEnd Date: 2025-04-30";
  const storage = await evaluate("JSON.stringify([localStorage, sessionStorage])");
  const check = async value => evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(value)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  await check(text);
  assert.equal(await evaluate("document.querySelectorAll('#reviewItems li').length"), 6);
  const validation = await evaluate("document.getElementById('validationReport').innerHTML");
  assert(await evaluate("!document.getElementById('intakeReview').outerHTML.includes('900-00') && !document.getElementById('intakeReview').outerHTML.includes('900000742')"));
  assert.equal(await evaluate("document.querySelector('.review-copy').textContent"), "Synthetic Example 0742");
  assert(await evaluate("[...document.querySelectorAll('#reviewItems .intake-canned-remarks')].length === 6 && [...document.querySelectorAll('#reviewItems .intake-canned-remarks')].every(a => new URL(a.href).pathname === '/canned-remarks/' && new URL(a.href).hash === '#things-to-notate-in-remarks') && [...document.querySelectorAll('.review-copy')].every(b => b.tagName === 'BUTTON' && b.type === 'button')"));
  assert(await evaluate(`([...document.querySelectorAll('.review-copy')].every(button => {
    button.focus();
    const style = getComputedStyle(button);
    return document.activeElement === button && button.getAttribute('aria-label').startsWith('Copy ') && !button.classList.contains('secondary-btn') && style.borderTopWidth === '0px' && style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.paddingTop === '0px';
  }))`), 'Copy controls look like plain text and remain keyboard focusable');
  await evaluate("window.copiedValue = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedValue = value; } } })");
  for (const [index, expected] of [[0, "Synthetic Example 0742"], [1, "synthetic@example.test"]]) {
    assert.equal(await evaluate(`(async () => {
      document.querySelectorAll('.review-copy')[${index}].click();
      for (let attempt = 0; attempt < 100; attempt++) {
        if (document.querySelectorAll('.copy-status')[${index}].textContent === 'Copied') return window.copiedValue;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Clipboard confirmation timed out');
    })()`), expected, 'Clipboard API receives exactly the displayed value');
  }
  await evaluate("window.copiedValue = ''; document.querySelector('.review-copy').click()");
  assert.equal(await evaluate("window.copiedValue"), "Synthetic Example 0742");
  assert.equal(await evaluate("document.querySelector('.copy-status').textContent"), "Copied");
  assert.equal(await evaluate("document.querySelector('.review-copy').textContent"), "Synthetic Example 0742");
  await evaluate("document.querySelectorAll('.review-copy')[1].click()");
  assert.equal(await evaluate("window.copiedValue"), "synthetic@example.test");
  await evaluate("navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; document.querySelector('.review-copy').click()");
  assert.equal(await evaluate("document.querySelector('.copy-status').textContent"), "Could not copy. Try again.");
  assert(await evaluate(`(() => {
    const review = document.getElementById('intakeReview').getBoundingClientRect();
    const divider = document.getElementById('reviewDivider').getBoundingClientRect();
    const report = document.getElementById('validationReport').getBoundingClientRect();
    const input = document.getElementById('intakeText');
    const left = document.querySelector('.intake-input').getBoundingClientRect();
    const right = document.querySelector('.intake-output').getBoundingClientRect();
    return review.bottom <= divider.top && divider.bottom <= report.top && divider.height >= 1 && input.getBoundingClientRect().height === (innerWidth > 1080 ? 350 : 260) && input.scrollHeight > input.clientHeight && getComputedStyle(input).overflowY === 'auto' && (innerWidth <= 1080 || left.height < right.height) && document.documentElement.scrollWidth <= innerWidth;
  })()`), 'Compact textarea and separate ordered sections');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#reviewItems li')).backgroundColor"), "rgb(255, 250, 235)");
  await evaluate("document.documentElement.dataset.theme = 'dark'");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#reviewItems li')).backgroundColor"), "rgb(41, 36, 22)");
  await evaluate("document.documentElement.dataset.theme = 'light'");
  for (const [message, expected] of [["Currently Working", "Currently working: Yes"], ["Other Names", "Used other names in medical records: Yes"], ["Separated", "Marital Status: Separated"], ["Failed Work Attempt — Most Recent Job", "Most Recent Job"]]) {
    const selection = await evaluate(`(() => {
      [...document.querySelectorAll('#reviewItems .intake-locate')].find(b => b.getAttribute('aria-label') === ${JSON.stringify("Find in Intake: " + message)}).click();
      const input = document.getElementById('intakeText');
      return input.value.slice(input.selectionStart, input.selectionEnd);
    })()`);
    assert.equal(selection, expected);
  }
  await evaluate("document.querySelector('#reviewItems button[aria-label^=\"Reviewed:\"]').click()");
  assert.equal(await evaluate("document.querySelectorAll('#reviewItems li').length"), 5);
  assert.equal(await evaluate("document.getElementById('validationReport').innerHTML"), validation);
  assert.equal(await evaluate("document.getElementById('intakeText').value"), text);
  await evaluate("document.querySelectorAll('#reviewItems button[aria-label^=\"Reviewed:\"]').forEach(b => b.click())");
  assert(await evaluate("!document.getElementById('reviewEmpty') && document.querySelectorAll('.review-copy').length === 2"));
  await check(text);
  assert.equal(await evaluate("document.querySelectorAll('#reviewItems li').length"), 6);
  if (capture) { await evaluate("document.querySelector('.intake-output').scrollTop = 0; window.scrollTo(0,0)"); await capture(); }
  await evaluate("document.getElementById('clearIntake').click()");
  assert(await evaluate("document.getElementById('intakeReview').hidden && !document.getElementById('reviewItems').children.length && !document.getElementById('reviewClient').children.length"));
  await check(text);
  assert.equal(await evaluate("document.querySelectorAll('#reviewItems li').length"), 6);
  await check("PERSONAL INFORMATION\nFirst Name: Synthetic\nSocial Security Number: 123");
  assert.equal(await evaluate("document.querySelector('.review-copy').textContent"), "Synthetic");
  assert(await evaluate("document.getElementById('reviewClient').textContent.includes('Email not provided') && !document.getElementById('reviewEmpty')"));
  await check("Unrecognized intake");
  assert(await evaluate("document.getElementById('intakeReview').hidden && document.getElementById('reviewDivider').hidden && !document.getElementById('reviewClient').children.length"));
  assert.equal(await evaluate("JSON.stringify([localStorage, sessionStorage])"), storage);
  assert.equal(await evaluate("window.intakeRequests"), 0);
  console.log(`PASS (${width}px): Remarks summary, clipboard success/failure, six flags, Canned Remarks actions, warning colors, source selection, dismissal/reset, validation isolation, layout and privacy.`);
}
