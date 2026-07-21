function parseBrazilianMoney(value) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return 0;
  }

  const cleaned = String(value)
    .replace(/\s*R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();

  const amount = Number.parseFloat(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function formatAmount(amount) {
  return amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatBrazilianMoney(amount, { emptyAsDash = true } = {}) {
  if (!amount || amount <= 0) {
    return emptyAsDash ? '-' : 'R$ 0,00';
  }

  return `R$ ${formatAmount(amount)}`;
}

function formatSessionRate(amount) {
  if (!amount || amount <= 0) {
    return '-';
  }

  return `R$ ${formatAmount(amount)}`;
}

module.exports = {
  parseBrazilianMoney,
  formatBrazilianMoney,
  formatSessionRate,
};
