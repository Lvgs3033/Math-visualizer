"""
Beautiful Math Visualizer - Flask backend
------------------------------------------
Provides three JSON API endpoints consumed by the JS frontend:

  POST /api/analyze  -> function values, exact symbolic derivative,
                         numeric + symbolic integral, ready for
                         plotting / animating on the client.
  POST /api/fourier   -> single-sided FFT magnitude/phase spectrum
                         of the sampled function.
  POST /api/validate  -> quick syntax check used while typing.

Sympy is used for exact symbolic differentiation/integration so the
displayed derivative/integral expressions are mathematically correct,
not numeric approximations. NumPy is used for fast vectorized
evaluation and the FFT.
"""

from flask import Flask, render_template, request, jsonify
import numpy as np
import sympy as sp
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor,
)

app = Flask(__name__)

x = sp.symbols("x")

_TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

# Whitelist of symbols/functions allowed inside a user expression.
# Keeping this explicit (rather than exec/eval) avoids any code
# injection risk from the free-text function input.
_ALLOWED_LOCALS = {
    "x": x,
    "pi": sp.pi,
    "e": sp.E,
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
    "asin": sp.asin,
    "acos": sp.acos,
    "atan": sp.atan,
    "sinh": sp.sinh,
    "cosh": sp.cosh,
    "tanh": sp.tanh,
    "exp": sp.exp,
    "log": sp.log,
    "ln": sp.log,
    "sqrt": sp.sqrt,
    "abs": sp.Abs,
    "Abs": sp.Abs,
    "factorial": sp.factorial,
}

MAX_POINTS = 4000


def parse_function(expr_str: str) -> sp.Expr:
    """Safely parse a user supplied function string into a sympy Expr."""
    if not expr_str or not expr_str.strip():
        raise ValueError("Function cannot be empty.")

    cleaned = expr_str.strip().replace("^", "**")

    try:
        expr = parse_expr(
            cleaned,
            local_dict=_ALLOWED_LOCALS,
            transformations=_TRANSFORMATIONS,
            evaluate=True,
        )
    except Exception:
        raise ValueError(f"Could not parse '{expr_str}'. Check parentheses and operators.")

    # Ensure no unexpected free symbols (e.g. user typed "y" or "z")
    free = expr.free_symbols - {x}
    if free:
        bad = ", ".join(sorted(str(s) for s in free))
        raise ValueError(f"Unknown symbol(s) in expression: {bad}. Only 'x' is allowed.")

    return expr


def safe_lambdify(expr: sp.Expr):
    return sp.lambdify(x, expr, modules=["numpy"])


def safe_eval_array(f, x_vals: np.ndarray) -> np.ndarray:
    """Evaluate f over x_vals, converting any complex/inf/error to NaN
    so Plotly simply renders a gap instead of the request failing."""
    out = np.empty_like(x_vals, dtype=float)
    with np.errstate(all="ignore"):
        try:
            raw = f(x_vals)
            raw = np.asarray(raw, dtype=complex) if np.iscomplexobj(raw) else np.asarray(raw, dtype=float)
        except Exception:
            raw = None

    if raw is None or np.isscalar(raw) or getattr(raw, "shape", None) == ():
        # Fallback: function is constant or vectorization failed -> loop
        for i, xv in enumerate(x_vals):
            out[i] = _safe_single(f, xv)
        return out

    if np.iscomplexobj(raw):
        mask_real = np.abs(raw.imag) < 1e-9
        vals = np.where(mask_real, raw.real, np.nan)
    else:
        vals = raw.astype(float)

    vals[~np.isfinite(vals)] = np.nan
    return vals


def _safe_single(f, xv: float) -> float:
    try:
        val = f(xv)
        if isinstance(val, complex):
            if abs(val.imag) > 1e-9:
                return float("nan")
            val = val.real
        val = float(val)
        if not np.isfinite(val):
            return float("nan")
        return val
    except Exception:
        return float("nan")


def cumulative_integral(x_vals: np.ndarray, y_vals: np.ndarray) -> np.ndarray:
    """Numeric running integral via the trapezoidal rule; robust to NaN gaps."""
    result = np.zeros_like(y_vals)
    for i in range(1, len(x_vals)):
        y0, y1 = y_vals[i - 1], y_vals[i]
        if np.isnan(y0) or np.isnan(y1):
            result[i] = result[i - 1]
            continue
        dx = x_vals[i] - x_vals[i - 1]
        result[i] = result[i - 1] + (y0 + y1) / 2.0 * dx
    return result


def clamp_points(points: int) -> int:
    try:
        points = int(points)
    except (TypeError, ValueError):
        points = 400
    return max(20, min(MAX_POINTS, points))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze():
    data = request.get_json(force=True, silent=True) or {}
    func_str = data.get("function", "sin(x)")
    try:
        x_min = float(data.get("xMin", -10))
        x_max = float(data.get("xMax", 10))
    except (TypeError, ValueError):
        return jsonify(success=False, error="Range values must be numbers."), 400

    points = clamp_points(data.get("points", 400))

    if x_min >= x_max:
        return jsonify(success=False, error="xMin must be less than xMax."), 400

    try:
        expr = parse_function(func_str)
        derivative_expr = sp.diff(expr, x)

        try:
            integral_expr = sp.integrate(expr, x)
            integral_expr_str = str(sp.nsimplify(integral_expr)) + " + C"
            if "Integral" in integral_expr_str:
                integral_expr_str = "No closed form (shown numerically)"
        except Exception:
            integral_expr_str = "No closed form (shown numerically)"

        f = safe_lambdify(expr)
        f_prime = safe_lambdify(derivative_expr)

        x_vals = np.linspace(x_min, x_max, points)
        y_vals = safe_eval_array(f, x_vals)
        dy_vals = safe_eval_array(f_prime, x_vals)
        integral_vals = cumulative_integral(x_vals, y_vals)

        return jsonify(
            success=True,
            x=x_vals.tolist(),
            y=_nan_to_none(y_vals),
            dy=_nan_to_none(dy_vals),
            integral=_nan_to_none(integral_vals),
            originalExpr=str(expr),
            derivativeExpr=str(derivative_expr),
            integralExpr=integral_expr_str,
        )
    except (sp.SympifyError, SyntaxError) as e:
        return jsonify(success=False, error=f"Could not parse function: {e}"), 400
    except ValueError as e:
        return jsonify(success=False, error=str(e)), 400
    except Exception as e:  # pragma: no cover - defensive catch-all
        return jsonify(success=False, error=f"Unexpected error: {e}"), 400


@app.route("/api/fourier", methods=["POST"])
def fourier():
    data = request.get_json(force=True, silent=True) or {}
    func_str = data.get("function", "sin(x)")
    try:
        x_min = float(data.get("xMin", -10))
        x_max = float(data.get("xMax", 10))
    except (TypeError, ValueError):
        return jsonify(success=False, error="Range values must be numbers."), 400

    points = clamp_points(data.get("points", 512))
    # FFT works best with an even sample count.
    if points % 2 != 0:
        points += 1

    if x_min >= x_max:
        return jsonify(success=False, error="xMin must be less than xMax."), 400

    try:
        expr = parse_function(func_str)
        f = safe_lambdify(expr)

        x_vals = np.linspace(x_min, x_max, points, endpoint=False)
        y_vals = safe_eval_array(f, x_vals)
        y_clean = np.nan_to_num(y_vals, nan=0.0, posinf=0.0, neginf=0.0)

        dx = (x_max - x_min) / points
        fft_vals = np.fft.fft(y_clean)
        freqs = np.fft.fftfreq(points, d=dx)

        half = points // 2
        magnitude = np.abs(fft_vals) / points
        magnitude_single = magnitude[:half] * 2.0
        magnitude_single[0] = magnitude[0]  # DC term is not doubled
        phase_single = np.angle(fft_vals)[:half]
        freqs_single = freqs[:half]

        return jsonify(
            success=True,
            x=x_vals.tolist(),
            y=y_vals.tolist() if not np.isnan(y_vals).any() else _nan_to_none(y_vals),
            freqs=freqs_single.tolist(),
            magnitude=magnitude_single.tolist(),
            phase=phase_single.tolist(),
            originalExpr=str(expr),
        )
    except (sp.SympifyError, SyntaxError) as e:
        return jsonify(success=False, error=f"Could not parse function: {e}"), 400
    except ValueError as e:
        return jsonify(success=False, error=str(e)), 400
    except Exception as e:  # pragma: no cover
        return jsonify(success=False, error=f"Unexpected error: {e}"), 400


@app.route("/api/validate", methods=["POST"])
def validate():
    data = request.get_json(force=True, silent=True) or {}
    func_str = data.get("function", "")
    try:
        expr = parse_function(func_str)
        return jsonify(success=True, expr=str(expr))
    except Exception as e:
        return jsonify(success=False, error=str(e)), 200


def _nan_to_none(arr: np.ndarray):
    """Convert NaNs to JSON-safe null so Plotly renders a gap in the line."""
    return [None if (v is None or (isinstance(v, float) and np.isnan(v))) else float(v) for v in arr]


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
