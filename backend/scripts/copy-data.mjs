import {copyFileSync, mkdirSync} from "node:fs";

const destination = new URL("../dist/nutrition/data/", import.meta.url);
mkdirSync(destination, {recursive: true});
for (const name of ["ingredients.json", "recipes.json"]) {
  copyFileSync(new URL(`../src/nutrition/data/${name}`, import.meta.url), new URL(name, destination));
}
