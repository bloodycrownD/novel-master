#!/usr/bin/env node
import { greet } from "@novel-master/core";

const name = process.argv[2] ?? "world";
console.log(greet(name));
