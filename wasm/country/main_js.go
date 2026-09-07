//go:build js && wasm

package main

import "syscall/js"

func main() {
	callback := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return -1
		}
		return classify(args[0].String())
	})
	defer callback.Release()
	js.Global().Set("classifyCountry", callback)
	select {}
}
