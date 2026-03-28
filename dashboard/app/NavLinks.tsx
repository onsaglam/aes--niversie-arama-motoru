"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/",          label: "Öğrenciler" },
  { href: "/timeline",  label: "Takvim" },
  { href: "/programs",  label: "Veritabanı" },
  { href: "/settings",  label: "Sistem" },
];

export default function NavLinks() {
  const path = usePathname();
  return (
    <>
      {links.map(({ href, label }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`text-xs transition-colors ${
              active
                ? "text-blue-600 font-semibold"
                : "text-slate-500 hover:text-blue-600"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
