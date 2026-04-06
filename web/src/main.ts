import { StubAuthService, type UserIdentity } from "./auth.js";
import { ANNUAL_RATE, formatCurrency, projectValue } from "./calculator.js";
import { createPlanningStorage, type SavedCalculation } from "./storage.js";

const auth = new StubAuthService();
const storage = createPlanningStorage();

const userPanel = document.querySelector<HTMLDivElement>("#user-panel");
const resultPanel = document.querySelector<HTMLDivElement>("#result-panel");
const form = document.querySelector<HTMLFormElement>("#calculator-form");
const amountInput = document.querySelector<HTMLInputElement>("#amount");
const yearsInput = document.querySelector<HTMLInputElement>("#years");

function requireElement<T extends Element>(element: T | null, selector: string): T {
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

const mountedUserPanel = requireElement(userPanel, "#user-panel");
const mountedResultPanel = requireElement(resultPanel, "#result-panel");
const mountedForm = requireElement(form, "#calculator-form");
const mountedAmountInput = requireElement(amountInput, "#amount");
const mountedYearsInput = requireElement(yearsInput, "#years");

function renderUser(user: UserIdentity): void {
  mountedUserPanel.innerHTML = `
    <div class="data-row">
      <span class="data-label">User ID</span>
      <strong>${user.id}</strong>
    </div>
    <div class="data-row">
      <span class="data-label">Email</span>
      <strong>${user.email}</strong>
    </div>
    <p class="helper-copy">This is a stubbed identity for now. The app is already shaped to swap in real auth later.</p>
  `;
}

function renderEmptyResult(): void {
  mountedResultPanel.innerHTML = `
    <p class="helper-copy">Enter a starting amount and a number of years to run the 4% projection.</p>
  `;
}

function renderResult(record: SavedCalculation): void {
  mountedResultPanel.innerHTML = `
    <div class="result-card">
      <p class="kicker">Projected value</p>
      <h3 class="result-amount">${formatCurrency(record.finalValue)}</h3>
      <p class="result-meta">
        ${formatCurrency(record.amount)} invested for ${record.years} year${record.years === 1 ? "" : "s"} at ${(ANNUAL_RATE * 100).toFixed(0)}% annually.
      </p>
      <p class="result-meta">Saved for ${record.email} on ${new Date(record.updatedAt).toLocaleString()}.</p>
    </div>
  `;
}

async function bootstrap(): Promise<void> {
  renderEmptyResult();

  const user = await auth.getCurrentUser();
  renderUser(user);

  const latestCalculation = await storage.getLatestCalculation(user.id);
  if (latestCalculation) {
    mountedAmountInput.value = String(latestCalculation.amount);
    mountedYearsInput.value = String(latestCalculation.years);
    renderResult(latestCalculation);
  }

  mountedForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = Number(mountedAmountInput.value);
    const years = Number(mountedYearsInput.value);

    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(years) || years < 0) {
      mountedResultPanel.innerHTML = `<p class="helper-copy">Use a non-negative amount and a whole number of years.</p>`;
      return;
    }

    const finalValue = projectValue({ amount, years });
    const record = await storage.saveCalculation({
      userId: user.id,
      email: user.email,
      amount,
      years,
      finalValue,
    });

    renderResult(record);
  });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  mountedResultPanel.innerHTML = `<p class="helper-copy">The app failed to load. Check the console for details.</p>`;
});
