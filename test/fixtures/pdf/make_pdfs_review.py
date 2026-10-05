"""Generator of the REVIEW fixtures (independent of make_pdfs.py). Usage: python3 test/fixtures/pdf/make_pdfs_review.py
Independent tester's SYNTHETIC PDFs (all names/values made up). Standard PDF fonts only (Helvetica / Times / Courier).
  1. fatura_intl_set.pdf     card fatura, dates "05 SET 2026" (with year), sections "Lançamentos nacionais" and
                             "Lançamentos internacionais" with a US$ column + R$ column, USD and EUR rows, a
                             "Dólar de conversão" line, IOF lines, a "Pagamento efetuado" credit, resumo box at the top.
  2. extrato_cd_quebra.pdf   checking extrato, Courier, amount column on the LEFT (Valor | Data | Histórico), dates
                             "05.09.2026", credits "C" / debits "D", descriptions wrapping to 2 lines, saldo anterior/final.
  3. extrato_2colunas.pdf    a page with two side-by-side columns of records (newspaper layout), Times, dd/mm/yyyy,
                             signed amounts "- 12,30" / "+ 500,00", per-column headers.
"""
import os, sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
W, H = A4


def t(cv, x, y, s, f='Helvetica', z=9):
    cv.setFont(f, z); cv.drawString(x, y, s)


def r(cv, x, y, s, f='Helvetica', z=9):
    cv.setFont(f, z); cv.drawRightString(x, y, s)


def brl(c):
    s = f'{abs(c) / 100:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return s


# ---------------------------------------------------------------------------------------------------- 1
def fatura_intl(path):
    cv = canvas.Canvas(path, pagesize=A4)
    t(cv, 40, H - 45, 'BANCO AZUL CELESTE S.A.', 'Helvetica-Bold', 13)
    t(cv, 40, H - 62, 'Fatura do cartão Azul Platinum · Titular: Beltrano Exemplar', z=9)
    nat = [('02 SET 2026', 'Restaurante Sabor Caseiro', 8790), ('07 SET 2026', 'Livraria Página Nova', 12450),
           ('11 SET 2026', 'Eletrônicos Faísca - Parc 02/05', 30000), ('19 SET 2026', 'Auto Posto Rota Sul', 21033)]
    intl = [('08 SET 2026', 'GITHUB INC SAN FRANCISCO', 'US$ 21,00', 11445), ('08 SET 2026', 'IOF TRANSACAO EXTERIOR', '', 401),
            ('14 SET 2026', 'BOOKSHOP LISBOA', 'EUR 30,00', 19110), ('14 SET 2026', 'IOF TRANSACAO EXTERIOR', '', 669)]
    pay = 45000
    total = sum(v for *_, v in nat) + sum(v for *_, v in intl) - pay + 45000  # saldo anterior 450,00 paid in full
    # summary box (must not be imported)
    t(cv, 40, H - 95, 'Resumo', 'Helvetica-Bold', 10)
    t(cv, 40, H - 110, 'Saldo da fatura anterior'); r(cv, 300, H - 110, 'R$ 450,00')
    t(cv, 40, H - 123, 'Pagamento efetuado'); r(cv, 300, H - 123, '- R$ 450,00')
    t(cv, 40, H - 136, 'Compras e lançamentos'); r(cv, 300, H - 136, 'R$ ' + brl(total))
    t(cv, 340, H - 110, 'Vencimento', 'Helvetica-Bold'); t(cv, 340, H - 123, '10 OUT 2026')
    t(cv, 440, H - 110, 'Valor total', 'Helvetica-Bold'); t(cv, 440, H - 123, 'R$ ' + brl(total))
    t(cv, 340, H - 140, 'Melhor data de compra: 01 OUT 2026', z=8)
    y = H - 180
    t(cv, 40, y, 'Lançamentos nacionais', 'Helvetica-Bold', 11); y -= 16
    t(cv, 40, y, 'DATA', 'Helvetica-Bold', 8); t(cv, 120, y, 'ESTABELECIMENTO', 'Helvetica-Bold', 8)
    r(cv, 440, y, 'US$', 'Helvetica-Bold', 8); r(cv, 555, y, 'R$', 'Helvetica-Bold', 8); y -= 14
    t(cv, 40, y, '25 SET 2026'); t(cv, 120, y, 'PAGAMENTO EFETUADO - OBRIGADO'); r(cv, 555, y, '- ' + brl(pay)); y -= 14
    for d, n, v in nat:
        t(cv, 40, y, d); t(cv, 120, y, n); r(cv, 555, y, brl(v)); y -= 14
    y -= 14
    t(cv, 40, y, 'Lançamentos internacionais', 'Helvetica-Bold', 11); y -= 16
    t(cv, 40, y, 'DATA', 'Helvetica-Bold', 8); t(cv, 120, y, 'ESTABELECIMENTO', 'Helvetica-Bold', 8)
    r(cv, 440, y, 'US$', 'Helvetica-Bold', 8); r(cv, 555, y, 'R$', 'Helvetica-Bold', 8); y -= 14
    for d, n, fx, v in intl:
        t(cv, 40, y, d); t(cv, 120, y, n)
        if fx:
            r(cv, 440, y, fx)
        r(cv, 555, y, brl(v)); y -= 14
    y -= 6
    t(cv, 40, y, 'Dólar de conversão: R$ 5,45', z=8); y -= 12
    t(cv, 40, y, 'Euro de conversão: R$ 6,37', z=8); y -= 20
    t(cv, 40, y, 'Total dos lançamentos atuais', 'Helvetica-Bold'); r(cv, 555, y, brl(total), 'Helvetica-Bold'); y -= 30
    t(cv, 40, y, 'Encargos: rotativo 14,50% a.m. · parcelamento 9,99% a.m. · CET 312,00% a.a.', z=7)
    t(cv, 40, 30, 'Central de atendimento 0800 000 0000', z=7)
    cv.save()
    return total


# ---------------------------------------------------------------------------------------------------- 2
def extrato_cd(path):
    cv = canvas.Canvas(path, pagesize=A4)
    F, FB = 'Courier', 'Courier-Bold'
    t(cv, 40, H - 45, 'COOPERATIVA VERDE-MAR DE CREDITO', FB, 12)
    t(cv, 40, H - 60, 'Extrato de conta corrente - Periodo: 01.09.2026 a 30.09.2026', F, 8)
    t(cv, 40, H - 72, 'Associado: Sicrana Fictícia   Conta: 0000-0', F, 8)
    rows = [('03.09.2026', ['DEPOSITO SALARIO EMPRESA', 'FICTICIA DE TESTES LTDA'], 650000, 'C'),
            ('04.09.2026', ['PAGTO CONTA ENERGIA', 'DISTRIBUIDORA LUZ DO VALE'], 18766, 'D'),
            ('09.09.2026', ['PIX ENVIADO'], 4500, 'D'),
            ('12.09.2026', ['COMPRA CARTAO DEBITO', 'MERCEARIA DO BAIRRO'], 9321, 'D'),
            ('15.09.2026', ['TARIFA PACOTE SERVICOS'], 2990, 'D'),
            ('22.09.2026', ['PIX RECEBIDO', 'FULANO DE TAL FICTICIO'], 12000, 'C'),
            ('28.09.2026', ['RESGATE APLICACAO', 'RDC POS FIXADO'], 30000, 'C')]
    bal = 123456
    y = H - 105
    t(cv, 40, y, 'VALOR', FB, 8); t(cv, 150, y, 'DATA', FB, 8); t(cv, 240, y, 'HISTORICO', FB, 8); r(cv, 555, y, 'SALDO', FB, 8); y -= 14
    t(cv, 240, y, 'SALDO ANTERIOR', F, 8); r(cv, 555, y, brl(bal) + ' C', F, 8); y -= 14
    for d, desc, v, cd in rows:
        bal += v if cd == 'C' else -v
        r(cv, 120, y, brl(v) + ' ' + cd, F, 8); t(cv, 150, y, d, F, 8); t(cv, 240, y, desc[0], F, 8); y -= 10
        for extra in desc[1:]:
            t(cv, 240, y, extra, F, 8); y -= 10
        y -= 4
    t(cv, 240, y, 'SALDO FINAL', FB, 8); r(cv, 555, y, brl(bal) + ' C', FB, 8)
    t(cv, 40, 30, 'Ouvidoria 0800 000 0001', F, 7)
    cv.save()
    return bal


# ---------------------------------------------------------------------------------------------------- 3
def extrato_2col(path):
    cv = canvas.Canvas(path, pagesize=A4)
    F, FB = 'Times-Roman', 'Times-Bold'
    t(cv, 40, H - 45, 'Banco Girassol Digital', FB, 15)
    t(cv, 40, H - 62, 'Extrato mensal · setembro de 2026 · Cliente: Joana Inventada', F, 9)
    left = [('01/09/2026', 'Padaria Trigo Dourado', -1230), ('02/09/2026', 'Transferência recebida', 50000),
            ('04/09/2026', 'Farmácia Bem Viver', -4590), ('06/09/2026', 'Cinema Estrela', -3800),
            ('08/09/2026', 'Assinatura Streaming Lux', -3990)]
    right_ = [('15/09/2026', 'Hortifruti Folha Verde', -6745), ('18/09/2026', 'Restaurante Mar Azul', -11880),
              ('21/09/2026', 'Estorno Loja Vento', 2500), ('25/09/2026', 'Pet Shop Amigo Fiel', -8950),
              ('29/09/2026', 'Uber Viagem Teste', -2735)]

    def sgn(v):
        return ('+ ' if v > 0 else '- ') + brl(v)
    for x0, xr, rows in ((40, 285, left), (310, 555, right_)):
        y = H - 100
        t(cv, x0, y, 'Data', FB, 9); t(cv, x0 + 60, y, 'Descrição', FB, 9); r(cv, xr, y, 'Valor (R$)', FB, 9); y -= 16
        for d, n, v in rows:
            t(cv, x0, y, d, F, 9); t(cv, x0 + 60, y, n, F, 9); r(cv, xr, y, sgn(v), F, 9); y -= 15
    t(cv, 40, 40, 'Documento sem valor fiscal.', F, 7)
    cv.save()
    return sum(v for *_, v in left + right_)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    print('fatura', fatura_intl(os.path.join(OUT, 'fatura_intl_set.pdf')))
    print('extrato cd saldo final', extrato_cd(os.path.join(OUT, 'extrato_cd_quebra.pdf')))
    print('2col net', extrato_2col(os.path.join(OUT, 'extrato_2colunas.pdf')))
