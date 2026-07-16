# Beautiful Math Visualizer

A Flask web app that plots functions, animates their derivatives and
integrals, and computes Fourier transforms — built with Flask, SymPy,
NumPy, and Plotly.js.

## Features

- **Plot any function of x** — type an expression like `sin(x)`, `x^2 - 3`,
  `exp(-x^2)`, or `1/(1+x^2)`. Parsing/validation happens live as you type.
- **Exact symbolic derivative** (via SymPy) plotted alongside the function,
  plus a **numeric integral** (trapezoidal rule) with the symbolic
  antiderivative shown when one exists in closed form.
- **Animate the derivative**: a tangent line sweeps along the curve while
  the derivative curve is traced out point by point, live.
- **Animate the integral**: the area under the curve fills in as a Riemann
  sum while the accumulated integral curve is traced on a second axis.
- **Fourier transform**: samples your function over the chosen interval and
  computes a single-sided FFT magnitude/phase spectrum with NumPy.
- Adjustable x-range, sample resolution, and animation speed.
- Dark, glassmorphism-inspired UI with quick-preset functions.

## Project structure

```
math-visualizer/
├── app.py                  # Flask backend + API endpoints
├── requirements.txt
├── templates/
│   └── index.html          # Single-page UI
└── static/
    ├── css/style.css       # Styling
    └── js/main.js          # Plotly rendering + animations
```

## Setup

1. **Create a virtual environment (recommended)**

   ```bash
   python3 -m venv venv
   source venv/bin/activate      # Windows: venv\Scripts\activate
   ```

2. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

3. **Run the app**

   ```bash
   python app.py
   ```

4. Open your browser at **http://127.0.0.1:5000**

## API endpoints

| Method | Route            | Purpose                                              |
|--------|-------------------|-------------------------------------------------------|
| POST   | `/api/analyze`    | Returns f(x), f'(x), ∫f(x)dx samples + expressions   |
| POST   | `/api/fourier`    | Returns FFT frequency/magnitude/phase spectrum        |
| POST   | `/api/validate`   | Lightweight parse check used for live input feedback  |

All three accept JSON: `{ "function": "sin(x)", "xMin": -10, "xMax": 10, "points": 400 }`.

## Supported function syntax

- Operators: `+ - * / ^` (or `**`), implicit multiplication (`2x` = `2*x`)
- Functions: `sin cos tan asin acos atan sinh cosh tanh exp log ln sqrt abs factorial`
- Constants: `pi`, `e`
- Only the variable `x` is allowed

## Notes

- The backend evaluates expressions through SymPy's safe parser (no
  `eval`/`exec` on user input), then lambdifies to NumPy for fast, vectorized
  sampling — invalid points (e.g. `tan(x)` asymptotes, `log` of a negative
  number) become gaps in the plot instead of crashing the request.
- The derivative is symbolic/exact; the integral is a numeric running
  trapezoidal sum (robust even when SymPy can't find a closed-form
  antiderivative), with the closed form shown in the sidebar when available.
