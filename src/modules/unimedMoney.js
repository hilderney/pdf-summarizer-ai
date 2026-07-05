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

function formatBrazilianMoney(amount, { emptyAsDash = true } = {}) {
  if (!amount || amount <= 0) {
    return emptyAsDash ? '-' : '0,00 R$';
  }

  const formatted = amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${formatted} R$`;
}

function formatSessionRate(amount) {
  if (!amount || amount <= 0) {
    return '-';
  }

  const formatted = amount.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${formatted} R$`;
}

module.exports = {
  parseBrazilianMoney,
  formatBrazilianMoney,
  formatSessionRate,
};
