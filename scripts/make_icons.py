#!/usr/bin/env python3
"""Gera os ícones do PWA (site/icons/*.png) com um glifo de "fluxo" (sankey).

Uso: python3 scripts/make_icons.py   (precisa de Pillow: pip install pillow)
Paleta sóbria da v1: fundo azul-petróleo, fluxos em sálvia / azul / ipê.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "site" / "icons"
BG = (23, 56, 63)          # azul-petróleo  #17383F
SOURCE = (237, 241, 236)   # #EDF1EC (sálvia clara, fundo da v1)
FLOWS = [
    ((169, 196, 176), 0.42),  # sálvia   #A9C4B0
    ((134, 169, 238), 0.33),  # azul     #86A9EE (accent escuro da v1)
    ((217, 154, 18), 0.25),   # ipê      #D99A12
]
SS = 4  # supersampling para bordas suaves


def smooth(t: float) -> float:
    return t * t * (3 - 2 * t)


def glyph(draw: ImageDraw.ImageDraw, x0: float, y0: float, size: float) -> None:
    """Desenha o glifo dentro do quadrado (x0, y0, size)."""
    bar_w = size * 0.12
    gap = size * 0.12
    left_x = x0
    right_x = x0 + size - bar_w
    src_total = size * 0.56            # origem mais baixa, centralizada
    dst_total = size                   # destinos abrem em leque até as bordas
    src_top = y0 + (size - src_total) / 2
    # barra de origem (uma só, à esquerda)
    draw.rounded_rectangle([left_x, src_top, left_x + bar_w, src_top + src_total], radius=bar_w * 0.35, fill=SOURCE)
    usable = dst_total - gap * (len(FLOWS) - 1)
    src_y = src_top
    dst_y = y0
    steps = 64
    for color, share in FLOWS:
        h = usable * share
        src_h = src_total * share
        a0, a1 = src_y, src_y + src_h
        b0, b1 = dst_y, dst_y + h
        xs = left_x + bar_w
        xe = right_x
        upper, lower = [], []
        for i in range(steps + 1):
            t = i / steps
            x = xs + (xe - xs) * t
            s = smooth(t)
            upper.append((x, a0 + (b0 - a0) * s))
            lower.append((x, a1 + (b1 - a1) * s))
        poly = upper + lower[::-1]
        faded = tuple(int(c * 0.78 + bg * 0.22) for c, bg in zip(color, BG))
        draw.polygon(poly, fill=faded)
        draw.rounded_rectangle([right_x, b0, right_x + bar_w, b1], radius=bar_w * 0.35, fill=color)
        src_y += src_h
        dst_y += h + gap


def render(px: int, *, maskable: bool, rounded: bool) -> Image.Image:
    big = px * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=BG)
    else:
        d.rectangle([0, 0, big, big], fill=BG)
    # maskable: o conteúdo precisa caber no círculo seguro (80% do diâmetro)
    frac = 0.50 if maskable else 0.64
    size = big * frac
    glyph(d, (big - size) / 2, (big - size) / 2, size)
    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    render(192, maskable=False, rounded=True).save(OUT / "icon-192.png", optimize=True)
    render(512, maskable=False, rounded=True).save(OUT / "icon-512.png", optimize=True)
    render(512, maskable=True, rounded=False).save(OUT / "icon-maskable-512.png", optimize=True)
    render(192, maskable=True, rounded=False).save(OUT / "icon-maskable-192.png", optimize=True)
    render(180, maskable=False, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    render(32, maskable=False, rounded=True).save(OUT / "favicon-32.png", optimize=True)
    # SVG simples para favicon de alta resolução não é necessário; PNG basta.
    print("ícones gerados em", OUT)


if __name__ == "__main__":
    main()
