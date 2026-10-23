import re
from io import BufferedReader

TEMPLATE_INTERPOLATION = re.compile(r"(?<!\\)(?:\\\\)*\$\{")


def extract(fileobj: BufferedReader, keywords: str, comment_tags: tuple, options: dict):
	code = fileobj.read().decode("utf-8")

	for lineno, funcname, messages in extract_javascript(code, options=options):
		if not messages or not messages[0]:
			continue

		# `funcname` here will be `__` which is our translation function. We
		# have to convert it back to usual function names
		funcname = "gettext"

		if isinstance(messages, tuple):
			if len(messages) == 3 and messages[2]:
				funcname = "pgettext"
				messages = (messages[2], messages[0])
			else:
				messages = messages[0]

		yield lineno, funcname, messages, []


def extract_typescript(fileobj: BufferedReader, keywords: str, comment_tags: tuple, options: dict):
	yield from extract(fileobj, keywords, comment_tags, {**options, "jsx": False})


def extract_javascript(code, keywords=None, options=None, lineno=1):
	"""Extract messages from JavaScript source code.

	This is a modified version of babel's JS parser. Reused under BSD license.
	License: https://github.com/python-babel/babel/blob/master/LICENSE

	Changes from upstream:
	- Preserve arguments, babel's parser flattened all values in args,
	  we need order because we use different syntax for translation
	  which can contain 2nd arg which is array of many values. If
	  argument is non-primitive type then value is NOT returned in
	  args.
	  E.g. __("0", ["1", "2"], "3") -> ("0", None, "3")
	- remove comments support
	- changed signature to accept string directly.

	:param code: code as string
	:param keywords: a list of keywords (i.e. function names) that should be recognized as translation functions
	    Defaults to ("__",)
	:param options: a dictionary of additional options (optional)
	    Supported options are:
	        * `template_string` -- set to false to disable ES6 template string support.
	        * `jsx` -- set to false for TypeScript without JSX.
	"""
	from babel.messages.jslexer import Token, tokenize, unquote_string

	if options is None:
		options = {}

	if keywords is None:
		keywords = ("__",)

	funcname = message_lineno = None
	messages = []
	last_argument = None
	concatenate_next = False
	argument_is_dynamic = False
	last_token = None
	call_stack = -1

	# Tree level = depth inside function call tree
	#  Example: __("0", ["1", "2"], "3")
	# Depth         __()
	#             /   |   \
	#   0       "0" [...] "3"  <- only 0th level strings matter
	#                /  \
	#   1          "1"  "2"
	tree_level = 0
	opening_operators = {"[", "{"}
	closing_operators = {"]", "}"}
	all_container_operators = opening_operators.union(closing_operators)
	dotted = any("." in kw for kw in keywords)
	outer_calls = []

	for token in tokenize(
		code,
		jsx=options.get("jsx", True),
		dotted=dotted,
		template_string=options.get("template_string", True),
		lineno=lineno,
	):
		if token.type == "template_string":
			yield from parse_template_string(token.value, keywords, options, token.lineno)

		if (  # Turn keyword`foo` expressions into keyword("foo") calls:
			funcname
			and (last_token and last_token.type == "name")  # have a keyword...
			and token.type  # we've seen nothing after the keyword...
			== "template_string"  # this is a template string
		):
			message_lineno = token.lineno
			messages = [None if _is_dynamic_template(token.value) else unquote_string(token.value)]
			call_stack = 0
			tree_level = 0
			token = Token("operator", ")", token.lineno)

		if token.type == "operator" and token.value == "(":
			if call_stack >= 0 and last_token.type == "name" and last_token.value in keywords:
				outer_calls.append(
					(
						funcname,
						message_lineno,
						messages,
						last_argument,
						concatenate_next,
						argument_is_dynamic,
						call_stack,
						tree_level,
					)
				)
				funcname = last_token.value
				message_lineno = token.lineno
				messages = []
				last_argument = None
				concatenate_next = False
				argument_is_dynamic = False
				call_stack = 0
				tree_level = 0
			elif funcname:
				message_lineno = token.lineno
				call_stack += 1

		elif call_stack >= 0 and token.type == "operator" and token.value in all_container_operators:
			if token.value in opening_operators:
				tree_level += 1
			if token.value in closing_operators:
				tree_level -= 1

		elif (call_stack == -1 and token.type == "linecomment") or token.type == "multilinecomment":
			pass  # ignore comments

		elif funcname and call_stack == 0:
			if token.type == "operator" and token.value == ")":
				if last_argument is not None:
					messages.append(last_argument)
				if len(messages) > 1:
					messages = tuple(messages)
				elif messages:
					messages = messages[0]
				else:
					messages = None

				if messages and messages[0]:
					yield (message_lineno, funcname, messages)

				if outer_calls:
					(
						funcname,
						message_lineno,
						messages,
						last_argument,
						concatenate_next,
						argument_is_dynamic,
						call_stack,
						tree_level,
					) = outer_calls.pop()
				else:
					funcname = message_lineno = last_argument = None
					concatenate_next = False
					argument_is_dynamic = False
					messages = []
					call_stack = -1
					tree_level = 0

			elif token.type in ("string", "template_string"):
				new_value = unquote_string(token.value)
				if tree_level > 0:
					pass
				elif token.type == "template_string" and _is_dynamic_template(token.value):
					argument_is_dynamic = True
					last_argument = None
				elif argument_is_dynamic:
					pass
				elif concatenate_next:
					last_argument = (last_argument or "") + new_value
					concatenate_next = False
				else:
					last_argument = new_value

			elif token.type == "operator":
				if token.value == ",":
					if last_argument is not None:
						messages.append(last_argument)
						last_argument = None
					else:
						if tree_level == 0:
							messages.append(None)
					concatenate_next = False
					if tree_level == 0:
						argument_is_dynamic = False
				elif token.value == "+":
					concatenate_next = True

		elif call_stack > 0 and token.type == "operator" and token.value == ")":
			call_stack -= 1

		elif funcname and call_stack == -1:
			funcname = None

		elif (
			call_stack == -1
			and token.type == "name"
			and token.value in keywords
			and (last_token is None or last_token.type != "name" or last_token.value != "function")
		):
			funcname = token.value

		last_token = token


def _is_dynamic_template(value):
	return TEMPLATE_INTERPOLATION.search(value) is not None


def parse_template_string(
	template_string,
	keywords,
	options,
	lineno=1,
):
	"""Parse JavaScript template string.

	This is a modified version of babel's JS parser. Reused under BSD license.
	License: https://github.com/python-babel/babel/blob/master/LICENSE

	:param template_string: the template string to be parsed
	:param keywords: a list of keywords (i.e. function names) that should be recognized as translation functions
	:param options: a dictionary of additional options (optional)
	:param lineno: starting line number (optional)
	"""
	prev_character = None
	current_lineno = lineno
	level = 0
	inside_expression_str = False
	expression_lineno = lineno
	expression_contents = ""
	interpolations = {match.end() - 1 for match in TEMPLATE_INTERPOLATION.finditer(template_string)}
	for index, character in enumerate(template_string[1:-1], start=1):
		if not level:
			if index in interpolations:
				expression_lineno = current_lineno
				level += 1
		else:
			expression_contents += character

			if inside_expression_str:
				if inside_expression_str == character and prev_character != r"\\":
					inside_expression_str = False
			else:
				if character in ('"', "'", "`"):
					inside_expression_str = character
				elif character == "{":
					level += 1
				elif character == "}":
					level -= 1
					if level == 0 and expression_contents:
						expression_contents = expression_contents[:-1]
						yield from extract_javascript(
							expression_contents,
							keywords,
							options,
							expression_lineno,
						)
						expression_contents = ""
						inside_expression_str = False
		if character == "\n":
			current_lineno += 1
		prev_character = character
