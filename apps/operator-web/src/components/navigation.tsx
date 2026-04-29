"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/intake", label: "Field Intake" },
  { href: "/replication", label: "Replication / Sync" },
  { href: "/custody", label: "Boxes / Queues / Shipments" },
  { href: "/grading", label: "Grading Workbench" },
  { href: "/analytics", label: "Analytical Results" },
  { href: "/pricing-exposure", label: "Pricing / Exposure" },
  { href: "/finance-ledger", label: "Financial Ledger" },
  { href: "/reconciliation", label: "Reconciliation" },
  { href: "/settlements", label: "Settlement" },
  { href: "/customer", label: "Customer View" },
  { href: "/audit", label: "Audit / Evidence" },
] as const;

export function Navigation() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="space-y-2">
      {NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`relative block rounded-md border px-3 py-2 text-sm transition ${
            isActive(link.href)
              ? "border-status-info/80 bg-status-info/15 pl-4 text-surface-50 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]"
              : "border-surface-700/60 bg-surface-900/70 text-surface-100 hover:border-status-info/70 hover:bg-surface-850"
          }`}
        >
          {isActive(link.href) ? (
            <span
              aria-hidden
              className="absolute inset-y-1 left-1 w-[3px] rounded-full bg-status-info"
            />
          ) : null}
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

