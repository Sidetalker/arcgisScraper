"""Minimal cross-platform GUI for the Summit County STR scraper."""

from __future__ import annotations

import io
import json
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from tkinter.scrolledtext import ScrolledText

import scrape_arcgis


PRESET_METADATA = scrape_arcgis.LAYER_PRESETS
DEFAULT_LAYER_PRESET = scrape_arcgis.DEFAULT_LAYER_PRESET
OWNER_LAYER_PRESET = scrape_arcgis.OWNER_LAYER_PRESET
OWNER_LAYER_FALLBACK_URL = (
    "https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/"
    "PrISM_APParcelPts_View_Layer_for_Query/FeatureServer/0"
)


def perform_query(config: dict) -> tuple[str, bool]:
    """Execute the scraper query and return the formatted payload and type."""

    geometry = scrape_arcgis.build_search_geometry(
        config["lat"],
        config["lng"],
        config["radius"],
    )

    gis = scrape_arcgis.create_gis(
        config["portal_url"],
        config["username"],
        config["password"],
        config["api_key"],
        config["referer"],
    )

    layer = scrape_arcgis.resolve_layer(
        gis,
        config["layer_url"],
        config["item_id"],
        config["layer_index"],
    )

    out_fields = config["out_fields"] or "*"
    if config["owner_table"]:
        out_fields = "*"

    if config["all_subdivisions"]:
        result = scrape_arcgis._query_all_subdivisions(  # pylint: disable=protected-access
            layer=layer,
            geometry=geometry,
            base_where=config["where_clause"],
            out_fields=out_fields,
            return_geometry=config["return_geometry"],
            max_records=config["max_records"],
        )
    else:
        result = scrape_arcgis.query_features(
            layer,
            geometry,
            where=config["where_clause"],
            out_fields=out_fields,
            return_geometry=config["return_geometry"],
            max_records=config["max_records"],
        )

    if config["owner_table"]:
        rows = scrape_arcgis._format_owner_table(result.features)  # pylint: disable=protected-access
        buffer = io.StringIO()
        scrape_arcgis._emit_owner_table(  # pylint: disable=protected-access
            rows,
            None,
            destination=buffer,
        )
        return buffer.getvalue(), True

    payload = json.dumps(result.to_dict(), indent=2)
    return payload, False


class ScraperGUI:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("Summit County STR Scraper")

        self.lat_var = tk.StringVar(value="39.4817")
        self.lng_var = tk.StringVar(value="-106.0455")
        self.radius_var = tk.StringVar(value="400")
        self.where_var = tk.StringVar(value="")
        self.out_fields_var = tk.StringVar(value="*")
        self.portal_var = tk.StringVar(value=scrape_arcgis.DEFAULT_PORTAL_URL)
        self.layer_var = tk.StringVar(value=OWNER_LAYER_FALLBACK_URL)
        self.item_id_var = tk.StringVar(value="")
        self.layer_index_var = tk.StringVar(value="0")
        self.referer_var = tk.StringVar(value=scrape_arcgis.DEFAULT_REFERER)
        self.api_key_var = tk.StringVar(value="")
        self.username_var = tk.StringVar(value="")
        self.password_var = tk.StringVar(value="")
        self.max_records_var = tk.StringVar(value="")

        self.owner_table_var = tk.BooleanVar(value=True)
        self.all_sub_var = tk.BooleanVar(value=True)
        self.return_geometry_var = tk.BooleanVar(value=False)

        self.status_var = tk.StringVar(value="Fill in the fields and click Run Query.")
        self.last_output: str = ""
        self.last_is_csv = False

        self._build_layout()

    def _build_layout(self) -> None:
        root = self.root
        root.geometry("960x700")

        main = ttk.Frame(root, padding=12)
        main.pack(fill=tk.BOTH, expand=True)

        form = ttk.Frame(main)
        form.pack(fill=tk.X)

        def add_entry(row: int, label: str, var: tk.StringVar, width: int = 25, **kwargs) -> ttk.Entry:
            ttk.Label(form, text=label).grid(row=row, column=0, sticky=tk.W, pady=2)
            entry = ttk.Entry(form, textvariable=var, width=width, **kwargs)
            entry.grid(row=row, column=1, sticky=tk.W, pady=2, padx=(8, 24))
            return entry

        row = 0
        add_entry(row, "Latitude", self.lat_var)
        add_entry(row + 1, "Longitude", self.lng_var)
        add_entry(row + 2, "Radius (m)", self.radius_var)
        add_entry(row + 3, "Max records", self.max_records_var)

        row += 4
        add_entry(row, "WHERE clause", self.where_var, width=60)
        add_entry(row + 1, "Out fields", self.out_fields_var, width=60)

        row += 2
        add_entry(row, "Portal URL", self.portal_var, width=60)
        add_entry(row + 1, "Layer URL", self.layer_var, width=60)
        add_entry(row + 2, "Item ID (optional)", self.item_id_var, width=60)
        add_entry(row + 3, "Layer index", self.layer_index_var)

        row += 4
        add_entry(row, "Referer", self.referer_var, width=60)
        add_entry(row + 1, "API key", self.api_key_var, width=60)
        add_entry(row + 2, "Username", self.username_var, width=30)
        add_entry(row + 3, "Password", self.password_var, width=30, show="*")

        checks = ttk.Frame(main)
        checks.pack(fill=tk.X, pady=(10, 0))
        ttk.Checkbutton(
            checks,
            text="Format owner mailing table",
            variable=self.owner_table_var,
        ).grid(row=0, column=0, sticky=tk.W)
        ttk.Checkbutton(
            checks,
            text="Query all subdivisions in radius",
            variable=self.all_sub_var,
        ).grid(row=0, column=1, sticky=tk.W, padx=12)
        ttk.Checkbutton(
            checks,
            text="Return geometry",
            variable=self.return_geometry_var,
        ).grid(row=0, column=2, sticky=tk.W)

        button_row = ttk.Frame(main)
        button_row.pack(fill=tk.X, pady=(8, 8))
        self.run_button = ttk.Button(button_row, text="Run Query", command=self.start_query)
        self.run_button.pack(side=tk.LEFT)
        ttk.Button(button_row, text="Use STR Layer", command=self._set_default_layer).pack(side=tk.LEFT, padx=8)
        ttk.Button(button_row, text="Use Owner Layer", command=self._set_owner_layer).pack(side=tk.LEFT)
        self.save_button = ttk.Button(button_row, text="Save Results…", command=self.save_results, state=tk.DISABLED)
        self.save_button.pack(side=tk.RIGHT)

        self.output = ScrolledText(main, wrap=tk.NONE, height=20, width=120)
        self.output.pack(fill=tk.BOTH, expand=True, pady=(4, 4))
        self.output.configure(font=("Menlo", 11) if self._is_macos() else None)

        status_bar = ttk.Label(main, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W, padding=4)
        status_bar.pack(fill=tk.X, side=tk.BOTTOM)

    def _is_macos(self) -> bool:
        return self.root.tk.call("tk", "windowingsystem") == "aqua"

    def _set_default_layer(self) -> None:
        self.layer_var.set(scrape_arcgis.DEFAULT_LAYER_URL)

    def _set_owner_layer(self) -> None:
        self.layer_var.set(OWNER_LAYER_FALLBACK_URL)

    def start_query(self) -> None:
        try:
            config = self._collect_form_values()
        except ValueError as exc:
            messagebox.showerror("Invalid input", str(exc), parent=self.root)
            return

        self.status_var.set("Running query…")
        self.run_button.config(state=tk.DISABLED)
        self.save_button.config(state=tk.DISABLED)
        self.output.delete("1.0", tk.END)
        self.last_output = ""
        self.last_is_csv = config["owner_table"]

        thread = threading.Thread(target=self._run_worker, args=(config,), daemon=True)
        thread.start()

    def _collect_form_values(self) -> dict:
        try:
            lat = float(self.lat_var.get())
            lng = float(self.lng_var.get())
            radius = float(self.radius_var.get())
        except ValueError as exc:
            raise ValueError("Latitude, longitude, and radius must be numeric.") from exc

        try:
            layer_index = int(self.layer_index_var.get() or "0")
        except ValueError as exc:
            raise ValueError("Layer index must be an integer.") from exc

        max_records_raw = self.max_records_var.get().strip()
        if max_records_raw:
            try:
                max_records = int(max_records_raw)
            except ValueError as exc:
                raise ValueError("Max records must be an integer.") from exc
        else:
            max_records = None

        return {
            "lat": lat,
            "lng": lng,
            "radius": radius,
            "where_clause": self.where_var.get().strip() or "1=1",
            "out_fields": self.out_fields_var.get().strip() or "*",
            "portal_url": self.portal_var.get().strip() or scrape_arcgis.DEFAULT_PORTAL_URL,
            "layer_url": self.layer_var.get().strip() or scrape_arcgis.DEFAULT_LAYER_URL,
            "item_id": self.item_id_var.get().strip() or None,
            "layer_index": layer_index,
            "referer": self.referer_var.get().strip() or scrape_arcgis.DEFAULT_REFERER,
            "api_key": self.api_key_var.get().strip() or None,
            "username": self.username_var.get().strip() or None,
            "password": self.password_var.get(),
            "max_records": max_records,
            "return_geometry": self.return_geometry_var.get(),
            "owner_table": self.owner_table_var.get(),
            "all_subdivisions": self.all_sub_var.get(),
        }

    def _run_worker(self, config: dict) -> None:
        try:
            data, is_csv = perform_query(config)
        except Exception as exc:  # pylint: disable=broad-except
            self.root.after(0, lambda: self._on_error(exc))
            return

        self.root.after(0, lambda: self._on_success(data, is_csv))

    def _on_success(self, data: str, is_csv: bool) -> None:
        self.last_output = data
        self.last_is_csv = is_csv
        self.output.insert("1.0", data)
        self.status_var.set(f"Finished ({'CSV' if is_csv else 'JSON'} output).")
        self.run_button.config(state=tk.NORMAL)
        self.save_button.config(state=tk.NORMAL if data else tk.DISABLED)

    def _on_error(self, exc: Exception) -> None:
        self.status_var.set("Query failed.")
        self.run_button.config(state=tk.NORMAL)
        messagebox.showerror("Error", str(exc), parent=self.root)

    def save_results(self) -> None:
        if not self.last_output:
            messagebox.showinfo("No results", "Run a query before saving.", parent=self.root)
            return

        default_ext = ".csv" if self.last_is_csv else ".json"
        filetypes = [("CSV files", "*.csv")] if self.last_is_csv else [("JSON files", "*.json")]
        filetypes.append(("All files", "*.*"))

        path = filedialog.asksaveasfilename(
            parent=self.root,
            defaultextension=default_ext,
            filetypes=filetypes,
        )
        if not path:
            return

        try:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(self.last_output)
        except OSError as exc:
            messagebox.showerror("Save failed", str(exc), parent=self.root)
            return

        self.status_var.set(f"Saved results to {path}")


def main() -> None:
    app = ScraperGUI()
    app.root.mainloop()


if __name__ == "__main__":
    main()
