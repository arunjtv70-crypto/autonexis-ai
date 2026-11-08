import ast
import concurrent.futures
import math
import re
from typing import Any, Dict, List

import mpmath
try:
    import sympy
    HAS_SYMPY = True
except ImportError:
    HAS_SYMPY = False

# Set high numeric precision (35 decimal digits)
mpmath.mp.dps = 35

MAX_EXPR_LENGTH = 1000
MAX_SERIES_STEPS = 1000
EVAL_TIMEOUT_SECONDS = 4.0

EXACT_MATH_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "exact_math",
        "description": (
            "Evaluate a numeric or symbolic math expression with exact high precision using mpmath and sympy. "
            "Use this tool for ANY multi-digit arithmetic, roots, powers, factorials, trig, logs, series partial sums (sum_k), "
            "or symbolic solving, simplifying, derivatives and integrals. Never guess numbers."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": (
                        "The math expression to evaluate. Examples: "
                        "'2 * sqrt(2) / 9801', "
                        "'(2 * sqrt(2) / 9801) * 1103', "
                        "'1 / pi', "
                        "'diff(x**3 + 2*x, x)', "
                        "'integrate(sin(x), (x, 0, pi))', "
                        "'solve(x**2 - 5*x + 6, x)', "
                        "'sum_k((fac(4*k)*(1103 + 26390*k)) / ((fac(k)**4) * (396**(4*k))), 0, 0)'"
                    )
                }
            },
            "required": ["expression"]
        }
    }
}

ALLOWED_AST_NODES = {
    ast.Expression,
    ast.Constant,
    ast.UnaryOp,
    ast.UAdd,
    ast.USub,
    ast.Not,
    ast.BinOp,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.Compare,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.Call,
    ast.Name,
    ast.Tuple,
    ast.List,
    ast.Load,
    ast.keyword,
}

def validate_ast(node: ast.AST):
    for subnode in ast.walk(node):
        if type(subnode) not in ALLOWED_AST_NODES:
            raise ValueError(f"Disallowed syntax or token: {type(subnode).__name__}")

def safe_sum_k(expr_str: str, start: int, end: int) -> mpmath.mpf:
    start = int(start)
    end = int(end)
    if end < start:
        return mpmath.mpf(0)
    if end - start > MAX_SERIES_STEPS:
        raise ValueError(f"Series range exceeds limit of {MAX_SERIES_STEPS} steps")

    total = mpmath.mpf(0)
    for k_val in range(start, end + 1):
        term_val = evaluate_numeric_ast(expr_str, local_vars={"k": mpmath.mpf(k_val)})
        total += term_val
    return total

def evaluate_numeric_ast(expr: str, local_vars: Dict[str, Any] = None) -> Any:
    tree = ast.parse(expr, mode='eval')
    validate_ast(tree)

    vars_dict = {
        "pi": mpmath.pi,
        "e": mpmath.e,
        "inf": mpmath.inf,
        "euler": mpmath.euler,
        "phi": mpmath.phi,
    }
    if local_vars:
        vars_dict.update(local_vars)

    funcs = {
        "sqrt": mpmath.sqrt,
        "cbrt": mpmath.cbrt,
        "fac": mpmath.fac,
        "factorial": mpmath.fac,
        "exp": mpmath.exp,
        "log": mpmath.log,
        "ln": mpmath.log,
        "log10": mpmath.log10,
        "log2": lambda x: mpmath.log(x, 2),
        "sin": mpmath.sin,
        "cos": mpmath.cos,
        "tan": mpmath.tan,
        "asin": mpmath.asin,
        "acos": mpmath.acos,
        "atan": mpmath.atan,
        "atan2": mpmath.atan2,
        "sinh": mpmath.sinh,
        "cosh": mpmath.cosh,
        "tanh": mpmath.tanh,
        "abs": mpmath.fabs,
        "fabs": mpmath.fabs,
        "floor": mpmath.floor,
        "ceil": mpmath.ceil,
        "round": round,
        "gcd": math.gcd,
        "lcm": math.lcm,
        "comb": mpmath.binomial,
    }

    def _eval(node):
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return mpmath.mpf(node.value)
            return node.value
        elif isinstance(node, ast.Name):
            if node.id in vars_dict:
                return vars_dict[node.id]
            raise ValueError(f"Unknown variable: '{node.id}'")
        elif isinstance(node, ast.UnaryOp):
            val = _eval(node.operand)
            if isinstance(node.op, ast.UAdd):
                return +val
            elif isinstance(node.op, ast.USub):
                return -val
            elif isinstance(node.op, ast.Not):
                return not val
        elif isinstance(node, ast.BinOp):
            left = _eval(node.left)
            right = _eval(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            elif isinstance(node.op, ast.Sub):
                return left - right
            elif isinstance(node.op, ast.Mult):
                return left * right
            elif isinstance(node.op, ast.Div):
                return left / right
            elif isinstance(node.op, ast.FloorDiv):
                return mpmath.floor(left / right)
            elif isinstance(node.op, ast.Mod):
                return left % right
            elif isinstance(node.op, ast.Pow):
                return mpmath.power(left, right)
        elif isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Nested function calls are restricted to whitelisted functions")
            fname = node.func.id
            if fname == "sum_k":
                args = [_eval(a) for a in node.args]
                if len(args) != 3:
                    raise ValueError("sum_k expects 3 arguments: (expr_str, start, end)")
                return safe_sum_k(str(args[0]), int(args[1]), int(args[2]))
            if fname in funcs:
                args = [_eval(a) for a in node.args]
                return funcs[fname](*args)
            raise ValueError(f"Function '{fname}' is not permitted")
        elif isinstance(node, ast.Tuple):
            return tuple(_eval(elt) for elt in node.elts)
        elif isinstance(node, ast.List):
            return [_eval(elt) for elt in node.elts]
        raise ValueError(f"Unsupported syntax structure: {type(node).__name__}")

    return _eval(tree.body)

def _internal_execute(expression: str) -> str:
    expression = expression.strip()
    if not expression:
        return "Error: Empty math expression"
    if len(expression) > MAX_EXPR_LENGTH:
        return f"Error: Expression length ({len(expression)}) exceeds limit of {MAX_EXPR_LENGTH} characters"

    symbolic_keywords = ["solve", "diff", "derivative", "integrate", "integral", "simplify", "expand", "factor"]
    is_symbolic = any(expression.startswith(kw) for kw in symbolic_keywords)

    if is_symbolic and HAS_SYMPY:
        try:
            tree = ast.parse(expression, mode='eval')
            validate_ast(tree)
            sym_vars = {s: sympy.Symbol(s) for s in ["x", "y", "z", "t", "k", "n", "a", "b", "c"]}
            sym_funcs = {
                "sin": sympy.sin,
                "cos": sympy.cos,
                "tan": sympy.tan,
                "exp": sympy.exp,
                "log": sympy.log,
                "ln": sympy.log,
                "sqrt": sympy.sqrt,
                "pi": sympy.pi,
                "E": sympy.E,
                "diff": sympy.diff,
                "derivative": sympy.diff,
                "integrate": sympy.integrate,
                "integral": sympy.integrate,
                "simplify": sympy.simplify,
                "expand": sympy.expand,
                "factor": sympy.factor,
                "solve": sympy.solve,
            }
            local_dict = {**sym_vars, **sym_funcs}
            sym_expr = sympy.sympify(expression, locals=local_dict, evaluate=True)
            return f"Exact symbolic result: {sym_expr}"
        except Exception as sym_err:
            return f"Symbolic calculation error: {sym_err}"

    try:
        val = evaluate_numeric_ast(expression)
        if isinstance(val, (mpmath.mpf, mpmath.mpc)):
            clean_str = mpmath.nstr(val, n=20)
            return f"Exact value: {clean_str}"
        return f"Result: {val}"
    except Exception as num_err:
        return f"Arithmetic calculation error: {num_err}"

def execute_exact_math(expression: str) -> str:
    """Executes a mathematical expression within a strictly timed thread pool."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_internal_execute, expression)
        try:
            return future.result(timeout=EVAL_TIMEOUT_SECONDS)
        except concurrent.futures.TimeoutError:
            return f"Error: Calculation timed out after {EVAL_TIMEOUT_SECONDS}s"
        except Exception as e:
            return f"Error: {e}"

def is_math_request(messages: List[Dict[str, Any]]) -> bool:
    """
    Detects if the incoming message thread contains a mathematical, scientific, or quantitative inquiry.
    Matches:
    - Attached images with equations or numbers
    - Explicit LaTeX syntax (\\frac, \\sqrt, $$, \\[, \\int, etc.)
    - Math keywords: solve, simplify, integral, derivative, prove, equation, formula, calculate, probability
    """
    if not messages:
        return False

    latest_msg = messages[-1] if messages else {}
    content = latest_msg.get("content", "")

    # 1. Check for image attachment
    has_image = False
    text_content = ""
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "image_url":
                    has_image = True
                elif part.get("type") == "text":
                    text_content += " " + str(part.get("text", ""))
    elif isinstance(content, str):
        text_content = content

    # If user provides an image, check if text suggests math OR formula OR if image request itself
    if has_image:
        image_math_keywords = [
            "formula", "equation", "solve", "math", "pi", "ramanujan", "calculate",
            "derive", "integral", "read", "what is this", "proof", "series", "sum"
        ]
        lower_t = text_content.lower()
        if any(kw in lower_t for kw in image_math_keywords) or len(text_content.strip()) < 10:
            return True

    lower_text = text_content.lower()

    # 2. Check for LaTeX patterns (strip escaped dollars and currency first)
    cleaned_latex_check = text_content.replace(r"\$", "")
    cleaned_latex_check = re.sub(r"(^|[\s(])\$(\d+(?:,\d{3})*(?:\.\d+)?)(?=$|[\s),.?!;:])", r"\1", cleaned_latex_check)

    latex_patterns = [
        r"\\[a-zA-Z]+",      # \frac, \sqrt, \sum, \int, \pi, etc.
        r"\$\$.*?\$\$",      # $$...$$
        r"(?<!\\)\$(?!\s)(?:[^\$\\]|\\.)+?(?<!\s)(?<!\\)\$", # Inline $...$ (non-currency)
        r"\\\[.*?\\\]",      # \[...\]
        r"\\\(.*?\\\)",      # \(...\)
        r"\^[0-9a-zA-Z{]",   # powers like x^2 or e^{x}
        r"_\{?[0-9a-zA-Z]",  # subscripts like x_1
    ]
    for pattern in latex_patterns:
        if re.search(pattern, cleaned_latex_check):
            return True

    # 3. Check for specific keywords
    math_keywords = [
        "solve", "simplify", "integral", "integrate", "derivative", "differentiate",
        "prove", "proof", "equation", "formula", "calculate", "probability",
        "quadratic", "matrix", "determinant", "eigenvalue", "polynomial", "logarithm",
        "trigonometry", "pythagor", "ramanujan", "factorial", "arithmetic", "fraction",
        "partial sum", "series", "hypotenuse"
    ]
    words = re.findall(r"\b[a-zA-Z]+\b", lower_text)
    if any(w in math_keywords for w in words):
        return True

    return False
