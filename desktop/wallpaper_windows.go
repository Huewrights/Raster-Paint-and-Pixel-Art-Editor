//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const (
	spiSetDeskWallpaper = 0x0014
	spifUpdateIniFile   = 0x01
	spifSendChange      = 0x02
	maxWallpaperBytes   = 64 << 20
)

var procSystemParametersInfoW = user32.NewProc("SystemParametersInfoW")

var pngSignature = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

var wallpaperStyles = map[string][2]string{
	"fill":   {"10", "0"},
	"tile":   {"0", "1"},
	"center": {"0", "0"},
}

func setWallpaper(dir, data, style string) error {
	values, ok := wallpaperStyles[style]
	if !ok {
		return errors.New("modo de plano de fundo desconhecido")
	}
	if len(data) > maxWallpaperBytes*4/3+4 {
		return errors.New("a imagem é grande demais para o plano de fundo")
	}
	content, err := base64.StdEncoding.DecodeString(data)
	if err != nil || !bytes.HasPrefix(content, pngSignature) {
		return errors.New("a imagem do plano de fundo chegou incompleta")
	}
	path := filepath.Join(dir, "Plano de fundo.png")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return plainError(err)
	}
	key, _, err := registry.CreateKey(registry.CURRENT_USER, `Control Panel\Desktop`, registry.SET_VALUE)
	if err != nil {
		return plainError(err)
	}
	defer key.Close()
	if err := key.SetStringValue("WallpaperStyle", values[0]); err != nil {
		return plainError(err)
	}
	if err := key.SetStringValue("TileWallpaper", values[1]); err != nil {
		return plainError(err)
	}
	target, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	ok2, _, callErr := procSystemParametersInfoW.Call(spiSetDeskWallpaper, 0, uintptr(unsafe.Pointer(target)), spifUpdateIniFile|spifSendChange)
	if ok2 == 0 {
		return plainError(callErr)
	}
	return nil
}
