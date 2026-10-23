import json

from .utils import get_line_number


def extract(fileobj, *args, **kwargs):
	"""Extract fraction labels from currencies materialized by the country factory."""
	text = fileobj.read().decode()
	data = json.loads(text)
	if not isinstance(data, dict):
		return

	seen_currencies = set()
	fractions = {}
	for country in data.values():
		if not isinstance(country, dict):
			continue
		currency = country.get("currency")
		if not isinstance(currency, str) or not currency or currency in seen_currencies:
			continue
		seen_currencies.add(currency)
		fraction = country.get("currency_fraction")
		if isinstance(fraction, str) and fraction:
			fractions.setdefault(fraction, []).append(currency)

	for fraction, currencies in fractions.items():
		yield (
			get_line_number(text, "currency_fraction", fraction),
			"pgettext",
			("Currency", fraction),
			["Currency fraction label for " + ", ".join(currencies)],
		)
