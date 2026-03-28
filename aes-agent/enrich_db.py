#!/usr/bin/env python3
"""
enrich_db.py — 2 Aşamalı DB Zenginleştirici CLI

Kullanım:
  python enrich_db.py --stats                  # Durumu göster
  python enrich_db.py --stage 1 --batch 20     # Sadece URL bul
  python enrich_db.py --stage 2 --batch 10     # Sadece detay tara
  python enrich_db.py --all --batch 15          # Her iki aşama
"""
import sys
import asyncio
import argparse
import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
sys.path.insert(0, str(Path(__file__).parent / "src"))

from rich.console import Console
from rich.table   import Table
from rich.progress import (
    Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn,
)
from rich import box

from database import ProgramDatabase
from enricher import get_enrichment_stats, run_stage1, run_stage2

console = Console()


def show_stats(db: ProgramDatabase) -> None:
    stats = get_enrichment_stats(db)
    total_needed = stats["needs_stage1"] + stats["needs_stage2"]

    t = Table(title="📊 Zenginleştirme Durumu", box=box.ROUNDED, show_header=True)
    t.add_column("Metrik", style="cyan", min_width=32)
    t.add_column("Değer", justify="right", style="white", min_width=8)

    t.add_row("Toplam Program", str(stats["total"]))
    t.add_row(
        "Stage 1 Gerekli  (URL Yok)",
        f"[yellow]{stats['needs_stage1']}[/yellow]",
    )
    t.add_row(
        "Stage 2 Gerekli  (Detay Eksik)",
        f"[orange3]{stats['needs_stage2']}[/orange3]",
    )
    t.add_row(
        "Toplam Bekleyen İşlem",
        f"[red]{total_needed}[/red]" if total_needed else "[green]0 — Temiz![/green]",
    )
    console.print(t)


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="AES DB Zenginleştirici — 2 aşamalı program detay tarayıcı"
    )
    parser.add_argument("--stage",   choices=["1", "2"],
                        help="Çalıştırılacak aşama (1=URL bul, 2=Detay tara)")
    parser.add_argument("--all",     action="store_true",
                        help="Her iki aşamayı sırayla çalıştır")
    parser.add_argument("--stats",   action="store_true",
                        help="Sadece istatistik göster, işlem yapma")
    parser.add_argument("--batch",   type=int, default=20,
                        help="Tek seferde işlenecek program sayısı (varsayılan: 20)")
    parser.add_argument("--verbose", action="store_true",
                        help="Detaylı log çıktısı")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    db = ProgramDatabase()

    # ── Sadece istatistik ──────────────────────────────────────────────────
    if args.stats or (not args.stage and not args.all):
        show_stats(db)
        return

    # ── Stage 1: URL Bulma ─────────────────────────────────────────────────
    if args.stage == "1" or args.all:
        console.print("\n[bold blue]⚡ Stage 1 — URL Bulma[/bold blue]")
        console.print(
            f"  [dim]Tavily arama kullanılarak URL'si olmayan {args.batch} "
            "program için URL aranacak[/dim]\n"
        )

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}", no_wrap=False),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            console=console,
        ) as prog:
            task = prog.add_task("Başlatılıyor...", total=args.batch)

            def s1_cb(done: int, total: int, uni: str) -> None:
                label = uni[:35] + "…" if len(uni) > 35 else uni
                prog.update(task, completed=done, total=total,
                            description=f"[cyan]{label}[/cyan]")

            result = await run_stage1(db, batch=args.batch, progress_cb=s1_cb)

        console.print(
            f"\n[green]✅ Stage 1 tamamlandı:[/green] "
            f"{result['found']} URL bulundu / "
            f"{result['failed']} bulunamadı "
            f"({result['processed']} program işlendi)"
        )

    # ── Stage 2: Detay Kazıma ──────────────────────────────────────────────
    if args.stage == "2" or args.all:
        s2_batch = min(args.batch, 10)   # Stage 2 her program için ~5-15 sn
        console.print(
            f"\n[bold blue]🕷️  Stage 2 — Detay Kazıma[/bold blue]"
        )
        console.print(
            f"  [dim]Playwright + Claude ile {s2_batch} program için "
            "deadline, dil şartı, NC detayları çekilecek[/dim]\n"
        )

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}", no_wrap=False),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            console=console,
        ) as prog:
            task = prog.add_task("Başlatılıyor...", total=s2_batch)

            def s2_cb(done: int, total: int, uni: str) -> None:
                label = uni[:35] + "…" if len(uni) > 35 else uni
                prog.update(task, completed=done, total=total,
                            description=f"[yellow]{label}[/yellow]")

            result = await run_stage2(db, batch=s2_batch, progress_cb=s2_cb)

        console.print(
            f"\n[green]✅ Stage 2 tamamlandı:[/green] "
            f"{result['success']} başarılı / "
            f"{result['failed']} başarısız "
            f"({result['processed']} program işlendi)"
        )

    # ── Son Durum ──────────────────────────────────────────────────────────
    console.print()
    show_stats(db)


if __name__ == "__main__":
    asyncio.run(main())
