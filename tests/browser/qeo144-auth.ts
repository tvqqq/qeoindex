import { expect, type Page } from "@playwright/test"

export async function loginQeo144(page: Page): Promise<void> {
  const email = process.env.QEO144_TEST_EMAIL
  const password = process.env.QEO144_TEST_PASSWORD

  if (!email || !password) {
    throw new Error("QEO144_TEST_EMAIL and QEO144_TEST_PASSWORD are required for browser acceptance")
  }

  await page.goto("/")
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/mật khẩu/i).fill(password)
  await page.getByRole("button", { name: /đăng nhập/i }).click()

  await expect(page.getByText(/đăng nhập qeoindex/i)).toBeHidden()
  await page.goto("/portfolio")
  await expect(page).toHaveURL(/\/portfolio/)
}
