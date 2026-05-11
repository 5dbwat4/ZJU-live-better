/* View borrowed books & renew */

import { ZJUAM, APILIB } from "login-zju";
import "dotenv/config";
import inquirer from "inquirer";

const am = new ZJUAM(process.env.ZJU_USERNAME, process.env.ZJU_PASSWORD);
const apilib = new APILIB(am);

const LIBRARY = "ZJU50";

function dateFormat(dateStr) {
  if (!dateStr) return "";
  if (dateStr.length === 8) {
    return dateStr.substring(0, 4) + "-" + dateStr.substring(4, 6) + "-" + dateStr.substring(6, 8);
  }
  return dateStr;
}

function daydiff(dateStr) {
  if (!dateStr) return null;
  let ds = dateStr;
  if (ds.length === 8) {
    ds = ds.substring(0, 4) + "-" + ds.substring(4, 6) + "-" + ds.substring(6, 8);
  }
  const target = new Date(ds + "T00:00:00");
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getDueStatus(dueDateStr) {
  const diff = daydiff(dueDateStr);
  if (diff == null) return { label: "Unknown", isOverdue: false, isNearDue: false };
  if (diff < 0) return { label: "Overdue", isOverdue: true, isNearDue: false };
  if (diff <= 7) return { label: "Due soon", isOverdue: false, isNearDue: true };
  return { label: "Borrowed", isOverdue: false, isNearDue: false };
}

function canRenew(item) {
  const z30 = item.z30 || {};
  const z36 = item.z36 || {};
  const { isOverdue } = getDueStatus(z36["z36-due-date"]);
  if (isOverdue) return false;
  if (z36["z36-letter-number"] && Number(z36["z36-letter-number"]) !== 0) return false;
  const itemStatus = z30["z30-item-status"];
  if (itemStatus === "12") return true;
  if (itemStatus === "11") return z36["z36-no-renewal"] === "0";
  return false;
}

async function main() {

  await apilib.fetch(`http://api.lib.zju.edu.cn/aleph/bor-auth?CON_LNG=chi`).catch(() => {});
  const borId = apilib.bor_id;
  if (!borId) {
    console.error("Login failed, no borrower ID obtained.");
    process.exit(1);
  }
  console.log("Login OK. Borrower ID:", borId);

  console.log("Fetching borrowing info...");
  const borResp = await apilib.fetch(`http://api.lib.zju.edu.cn/aleph/bor_info?bor_id=${borId}`);
  const borJson = await borResp.json();

  const borInfo = borJson.data?.["bor-info"];
  if (!borInfo || borInfo.error) {
    console.error("Failed to fetch borrow info:", borInfo?.error || "Unknown error");
    process.exit(1);
  }

  const loanItems = borInfo["item-l"];
  const holdItems = borInfo["item-h"];

  const loans = Array.isArray(loanItems) ? loanItems : loanItems ? [loanItems] : [];
  const holds = Array.isArray(holdItems) ? holdItems : holdItems ? [holdItems] : [];

  console.log(`========== Overview ==========`);
  console.log(`  Current loans: ${loans.length}`);
  // console.log(`  Current holds: ${holds.length}`);

  let renewList = [];

  if (loans.length === 0) {
    console.log("No current loans.");
    return;
  }

  console.log(`---------- Current Loans ----------`);
  let hasOverdue = false;
  for (let i = 0; i < loans.length; i++) {
    const item = loans[i];
    const bookName = item.z13?.["z13-title"] || "Unknown";
    const author = item.z13?.["z13-author"] ? `  -- ${item.z13["z13-author"]}` : "";
    const barcode = item.z30?.["z30-barcode"] || "";
    const loanDate = dateFormat(item.z36?.["z36-loan-date"]);
    const dueDate = dateFormat(item.z36?.["z36-due-date"]);
    const remaining = daydiff(item.z36?.["z36-due-date"]);
    const { label: status, isOverdue } = getDueStatus(item.z36?.["z36-due-date"]);
    const renewable = canRenew(item);
    if (isOverdue) hasOverdue = true;

    const remainStr = remaining != null ? ` (${remaining} days remains)` : "";

    console.log(`[${i + 1}] ${bookName}${author}`);
    console.log(`    Loan date: ${loanDate}    Due date: ${dueDate}${remainStr}`);
    console.log(`    Status: ${status}${renewable ? "  [Renewable]" : ""}`);

    if (renewable) {
      renewList.push({ index: i + 1, barcode, title: bookName, dueDate });
    }
  }
  if (renewList.length === 0 ){
    console.log("No renewable books.");
    return;
  }
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Renewal:",
      choices: [
        { name: "Renew all", value: "all" },
        { name: "Select items to renew", value: "select" },
        { name: "Exit", value: "none" },
      ],
    },
  ]);

  if (action === "none") {
    console.log("Bye");
    return;
  }

  let toRenew = action === "select" ? 
    (await inquirer.prompt([
      {
        type: "checkbox",
        name: "selected",
        message: "Select books to renew (space to toggle):",
        choices: renewList.map((r) => ({
          name: `[${r.index}] ${r.title} (due: ${r.dueDate})`,
          value: r,
        })),
      },
    ])).selected : 
    renewList;

  if (toRenew.length > 0) {
    console.log("Renewing...");
    let success = 0, fail = 0;
    for (const r of toRenew) {
      const resp = await apilib.fetch(
          `http://api.lib.zju.edu.cn/aleph/renew?CON_LNG=chi&bor-id=${borId}&library=${LIBRARY}&item_barcode=${r.barcode}`
      );
      const d = await resp.json();
      const ok = d?.data?.renew?.reply === "ok";
      console.log(`  [${r.index}] ${r.title}: ${ok ? "OK" : "FAILED"}`);
      ok ? success++ : fail++;
    }
    console.log(`Done: ${success} OK, ${fail} failed`);
  }

}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
