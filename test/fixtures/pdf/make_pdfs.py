"""Generates the SYNTHETIC test PDFs of test/fixtures/pdf/ (every name, value and number here is made up).

Usage: python3 test/fixtures/pdf/make_pdfs.py      (needs reportlab + Pillow; pip install --break-system-packages reportlab)
The PDFs are committed; rerun only to change them. Different layouts on purpose, so the PDF reader is not tuned to one bank:
  a. fatura_roxa.pdf          card fatura, year-less "05 SET" dates, "−R$" payments/estorno, inline "Parcela 3/10" (dated by the original purchase),
                              an international section (USD amount + Cotação + R$ on one row; EUR on a detail line) + IOF,
                              a "Compras parceladas — próximas faturas" section (must NOT be imported), resumo, 2 pages with
                              a repeated header/footer
  b. extrato_laranja.pdf      checking extrato table Data/Lançamento/Valor/Saldo, dd/mm dates, SALDO ANTERIOR / SALDO DO DIA
                              lines, 2 pages with a repeated header and "Página x de y" footer
  c. beneficio_valebem.pdf    benefit card, one line per record "03/10 Compra • Restaurante X  Refeição  R$ 45,90 D" (C/D)
  d. fatura_protegida.pdf     a small fatura encrypted with the password "12345"
  e. digitalizado.pdf         an image only (no text layer), like a scanned page
  f. conta_eur.pdf            a foreign account statement with EUR amounts only (two months)
"""
import io, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONTB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('DV', FONT))
pdfmetrics.registerFont(TTFont('DVB', FONTB if os.path.exists(FONTB) else FONT))
W, H = A4


def brl(c, sign=''):
    s = f'{abs(c) // 100:,}'.replace(',', '.') + ',' + f'{abs(c) % 100:02d}'
    return f'{sign}R$ {s}'


def num(c):
    return ('-' if c < 0 else '') + f'{abs(c) // 100:,}'.replace(',', '.') + ',' + f'{abs(c) % 100:02d}'


def right(cv, x, y, txt, font='DV', size=9):
    cv.setFont(font, size)
    cv.drawRightString(x, y, txt)


def text(cv, x, y, txt, font='DV', size=9):
    cv.setFont(font, size)
    cv.drawString(x, y, txt)


# ------------------------------------------------------------------------------------------------ a. fatura (Nubank-like)
def fatura_roxa(path, encrypt=None, short=False):
    cv = canvas.Canvas(path, pagesize=A4, encrypt=encrypt)
    purchases = [('28 AGO', 'Padaria Pão Quente', 1890), ('02 SET', 'Uber *Trip Help', 2340), ('04 SET', 'Supermercado Boa Compra', 21875),
                 ('08 JUL', 'Loja Eletro Casa - Parcela 3/10', 15000), ('11 SET', 'Farmácia Saúde Já', 4590), ('19 SET', 'Posto Avenida Central', 18000)]
    credits = [('05 SET', 'Pagamento recebido', 50000), ('12 SET', 'Estorno Loja Moda Fina', 2000)]
    intl = [('15 SET', 'Netflix.com', 'USD 12,99', '5,20', 6755), ('18 SET', 'Spotify AB', 'EUR 5,00', '6,00', 3000)]
    iof = [('15 SET', 'IOF de compra internacional', 236), ('18 SET', 'IOF de compra internacional', 105)]
    future = [('08 JUL', 'Loja Eletro Casa', 'Parcela 4/10', 15000), ('08 JUL', 'Loja Eletro Casa', 'Parcela 5/10', 15000), ('08 JUL', 'Loja Eletro Casa', 'Parcela 6/10', 15000)]
    if short:
        purchases, credits, intl, iof, future = purchases[:3], [], [], [], []
    prev = 50000 if not short else 0
    total = prev + sum(p[2] for p in purchases) + sum(i[4] for i in intl) + sum(i[2] for i in iof) - sum(c[2] for c in credits)

    def chrome(page, pages):
        text(cv, 40, H - 40, 'Banco Roxo Exemplo · Cartão de crédito', 'DVB', 10)
        right(cv, W - 40, H - 40, 'Fulana de Teste', size=9)
        text(cv, W / 2 - 30, 30, f'Página {page} de {pages}', size=8)
    pages = 1 if short else 2
    chrome(1, pages)
    y = H - 90
    text(cv, 40, y, 'Esta é a sua fatura de outubro', 'DVB', 14); y -= 26
    text(cv, 40, y, 'Data de vencimento: 05 OUT 2026'); text(cv, 300, y, 'Emissão e envio: 28 SET 2026'); y -= 16
    text(cv, 40, y, 'Período vigente: 28 AGO a 27 SET'); y -= 26
    text(cv, 40, y, 'Total a pagar', 'DVB', 11); right(cv, 250, y, brl(total), 'DVB', 11); y -= 18
    text(cv, 40, y, 'Pagamento mínimo'); right(cv, 250, y, brl(round(total * 0.15))); y -= 16
    text(cv, 40, y, 'Limite disponível'); right(cv, 250, y, brl(312345)); y -= 30
    text(cv, 40, y, 'Resumo da fatura atual', 'DVB', 11); y -= 18
    for lbl, v in [('Fatura anterior', brl(prev)), ('Pagamento recebido', brl(sum(c[2] for c in credits[:1]), '−')), ('Total de compras', brl(sum(p[2] for p in purchases) + sum(i[4] for i in intl))),
                   ('Outros lançamentos', brl(sum(i[2] for i in iof))), ('Créditos e estornos', brl(sum(c[2] for c in credits[1:]), '−')), ('Total desta fatura', brl(total))]:
        text(cv, 50, y, lbl); right(cv, 300, y, v); y -= 15
    y -= 20
    text(cv, 40, y, 'Transações de 28 AGO a 27 SET', 'DVB', 11); y -= 18
    text(cv, 40, y, 'Data', 'DVB', 8); text(cv, 100, y, 'Descrição', 'DVB', 8); right(cv, W - 40, y, 'Valor', 'DVB', 8); y -= 16
    rows = sorted([(d, n, brl(v)) for d, n, v in purchases] + [(d, n, brl(v, '−')) for d, n, v in credits], key=lambda r: (['JUL', 'AGO', 'SET'].index(r[0][3:]), r[0][:2]))
    for d, n, v in rows:
        text(cv, 40, y, d); text(cv, 100, y, n); right(cv, W - 40, y, v); y -= 16
    if intl:
        y -= 14
        text(cv, 40, y, 'Compras internacionais', 'DVB', 11); y -= 18
        d, n, fx, rate, v = intl[0]
        text(cv, 40, y, d); text(cv, 100, y, n); text(cv, 300, y, f'{fx} · Cotação R$ {rate}'); right(cv, W - 40, y, brl(v)); y -= 16
        d, n, v = iof[0]
        text(cv, 40, y, d); text(cv, 100, y, n); right(cv, W - 40, y, brl(v)); y -= 16
        d, n, fx, rate, v = intl[1]
        text(cv, 40, y, d); text(cv, 100, y, n); right(cv, W - 40, y, brl(v)); y -= 12
        text(cv, 100, y, f'{fx} · Cotação R$ {rate}', size=8); y -= 16
        d, n, v = iof[1]
        text(cv, 40, y, d); text(cv, 100, y, n); right(cv, W - 40, y, brl(v)); y -= 16
    if pages == 2:
        cv.showPage()
        chrome(2, pages)
        y = H - 90
        text(cv, 40, y, 'Compras parceladas — próximas faturas', 'DVB', 11); y -= 18
        for d, n, p, v in future:
            text(cv, 40, y, d); text(cv, 100, y, n); text(cv, 300, y, p); right(cv, W - 40, y, brl(v)); y -= 16
        y -= 10
        text(cv, 40, y, 'Total parcelado a vencer'); right(cv, W - 40, y, brl(sum(f[3] for f in future))); y -= 30
        text(cv, 40, y, 'Parcele esta fatura', 'DVB', 11); y -= 18
        text(cv, 40, y, 'Entrada + 5x de R$ 96,30'); text(cv, 300, y, 'Total: R$ 577,80'); y -= 16
        text(cv, 40, y, 'Juros 9,90% a.m. CET 210,00% a.a.')
    cv.save()
    return total


# ------------------------------------------------------------------------------------------------ b. extrato (Itaú-like)
def extrato_laranja(path):
    cv = canvas.Canvas(path, pagesize=A4)
    rows = [('02/09', 'PIX RECEBIDO MARIA EXEMPLO', 50000), ('02/09', 'PAG BOLETO CONDOMINIO ED SOL', -68000), ('03/09', 'COMPRA CARTAO DEB PADARIA BOM DIA', -1250),
            ('05/09', 'TED RECEBIDA SALARIO EMPRESA FICTICIA', 650000), ('05/09', 'PIX ENVIADO JOAO EXEMPLO', -15000), ('08/09', 'TAR PACOTE SERVICOS', -3290),
            ('10/09', 'PAGAMENTO FATURA CARTAO', -120000), ('11/09', 'COMPRA CARTAO DEB MERCADO DO BAIRRO', -18770), ('12/09', 'RENDIMENTO POUPANCA', 1234),
            ('15/09', 'PIX ENVIADO ALUGUEL IMOBILIARIA TESTE', -180000), ('16/09', 'COMPRA CARTAO DEB FARMACIA POPULAR', -4560), ('18/09', 'DEBITO AUTOMATICO ENERGIA LUZ', -21345),
            ('20/09', 'PIX RECEBIDO REEMBOLSO AMIGO', 4500), ('22/09', 'COMPRA CARTAO DEB POSTO ESTRELA', -15000), ('25/09', 'SAQUE 24H', -20000),
            ('26/09', 'PIX ENVIADO ACADEMIA FORCA', -9990), ('28/09', 'COMPRA CARTAO DEB RESTAURANTE SABOR', -6430), ('29/09', 'TED RECEBIDA FREELA PROJETO', 120000),
            ('30/09', 'IOF', -38)]
    opening = 245000

    def chrome(page, pages):
        text(cv, 40, H - 40, 'Banco Laranja Exemplo S.A.', 'DVB', 11)
        text(cv, 40, H - 55, 'Extrato de conta corrente · Agência 0001 · Conta 12345-6', size=8)
        right(cv, W - 40, H - 40, 'Emitido em 01/10/2026', size=8)
        text(cv, 40, 28, 'Banco Laranja Exemplo · SAC 0800 000 0000 · Ouvidoria 0800 000 0001', size=7)
        right(cv, W - 40, 28, f'Página {page} de {pages}', size=7)

    def header(y):
        text(cv, 40, y, 'Data', 'DVB', 8); text(cv, 95, y, 'Lançamento', 'DVB', 8); right(cv, 430, y, 'Valor (R$)', 'DVB', 8); right(cv, W - 40, y, 'Saldo (R$)', 'DVB', 8)
        return y - 16
    chrome(1, 2)
    y = H - 85
    text(cv, 40, y, 'Período: 01/09/2026 a 30/09/2026', size=9); y -= 22
    text(cv, 40, y, 'Lançamentos', 'DVB', 11); y -= 18
    y = header(y)
    text(cv, 40, y, '01/09'); text(cv, 95, y, 'SALDO ANTERIOR'); right(cv, W - 40, y, num(opening)); y -= 15
    bal = opening
    page = 1
    for k, (d, n, v) in enumerate(rows):
        if y < 80:
            cv.showPage(); page += 1; chrome(page, 2); y = H - 85
            text(cv, 40, y, 'Lançamentos (continuação)', 'DVB', 11); y -= 18
            y = header(y)
        bal += v
        last_of_day = k == len(rows) - 1 or rows[k + 1][0] != d
        text(cv, 40, y, d); text(cv, 95, y, n); right(cv, 430, y, num(v))
        y -= 15
        if last_of_day:
            text(cv, 95, y, 'SALDO DO DIA'); right(cv, W - 40, y, num(bal)); y -= 15
        if k == 11:
            y = 70  # force the page break
    cv.save()
    return opening, bal


# ------------------------------------------------------------------------------------------------ c. benefit card, one line per record
def beneficio(path):
    cv = canvas.Canvas(path, pagesize=A4)
    text(cv, 40, H - 50, 'ValeBem Benefícios', 'DVB', 14)
    text(cv, 40, H - 68, 'Extrato do cartão benefícios · Refeição e Alimentação', size=9)
    text(cv, 40, H - 90, 'Emitido em 04/10/2026', size=8)
    text(cv, 40, H - 110, 'Saldo disponível', size=9); right(cv, 250, H - 110, 'R$ 312,40', 'DVB', 10)
    y = H - 150
    text(cv, 40, y, 'Movimentações', 'DVB', 11); y -= 18
    text(cv, 40, y, 'Data', 'DVB', 8); text(cv, 90, y, 'Descrição', 'DVB', 8); text(cv, 330, y, 'Carteira', 'DVB', 8); right(cv, W - 40, y, 'Valor', 'DVB', 8); y -= 16
    rows = [('03/10', 'Compra • Restaurante Sabor Caseiro', 'Refeição', 'R$ 45,90 D'), ('02/10', 'Compra • Padaria Trigo Bom', 'Refeição', 'R$ 18,50 D'),
            ('01/10', 'Crédito de benefício', 'Refeição', 'R$ 600,00 C'), ('01/10', 'Crédito de benefício', 'Alimentação', 'R$ 400,00 C'),
            ('28/09', 'Transferência entre carteiras', 'Alimentação', 'R$ 50,00 C'), ('28/09', 'Transferência entre carteiras', 'Refeição', 'R$ 50,00 D'),
            ('25/09', 'Compra • Mercado Bom Preço', 'Alimentação', 'R$ 120,35 D'), ('20/09', 'Estorno • Restaurante Sabor Caseiro', 'Refeição', 'R$ 12,00 C')]
    for d, n, w, v in rows:
        text(cv, 40, y, d); text(cv, 90, y, n); text(cv, 330, y, w); right(cv, W - 40, y, v); y -= 16
    text(cv, 40, 30, 'ValeBem Benefícios · central 4000-0000', size=7)
    cv.save()


# ------------------------------------------------------------------------------------------------ e. image only
def digitalizado(path):
    from PIL import Image, ImageDraw
    img = Image.new('L', (900, 1200), 255)
    dr = ImageDraw.Draw(img)
    for k in range(25):
        dr.rectangle([60, 80 + k * 42, 60 + 300 + (k * 37) % 400, 96 + k * 42], fill=40)
    buf = io.BytesIO(); img.save(buf, format='PNG'); buf.seek(0)
    from reportlab.lib.utils import ImageReader
    cv = canvas.Canvas(path, pagesize=A4)
    cv.drawImage(ImageReader(buf), 20, 20, W - 40, H - 40)
    cv.save()


# ------------------------------------------------------------------------------------------------ f. EUR account
def conta_eur(path):
    cv = canvas.Canvas(path, pagesize=A4)
    text(cv, 40, H - 50, 'Conta Global Exemplo', 'DVB', 14)
    text(cv, 40, H - 68, 'Extrato da conta em euro · Moeda: EUR', size=9)
    text(cv, 40, H - 84, 'Gerado em 02/10/2026', size=8)
    y = H - 120
    text(cv, 40, y, 'Data', 'DVB', 8); text(cv, 120, y, 'Descrição', 'DVB', 8); right(cv, W - 40, y, 'Valor', 'DVB', 8); y -= 16
    rows = [('12/09/2026', 'Café de Flore Paris', '-€ 18,50'), ('13/09/2026', 'Hotel Lumière', '-€ 240,00'), ('14/09/2026', 'Depósito recebido', '+€ 500,00'),
            ('20/09/2026', 'Musée du Louvre', '-€ 22,00'), ('01/10/2026', 'Metro Paris', '-€ 2,10')]
    for d, n, v in rows:
        text(cv, 40, y, d); text(cv, 120, y, n); right(cv, W - 40, y, v); y -= 16
    cv.save()


if __name__ == '__main__':
    t = fatura_roxa(os.path.join(HERE, 'fatura_roxa.pdf'))
    o, c = extrato_laranja(os.path.join(HERE, 'extrato_laranja.pdf'))
    beneficio(os.path.join(HERE, 'beneficio_valebem.pdf'))
    fatura_roxa(os.path.join(HERE, 'fatura_protegida.pdf'), encrypt='12345', short=True)
    digitalizado(os.path.join(HERE, 'digitalizado.pdf'))
    conta_eur(os.path.join(HERE, 'conta_eur.pdf'))
    print('fatura total', t, 'extrato', o, '->', c)
