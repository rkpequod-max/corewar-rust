# Corewar — Rust

Traduction du projet Corewar (C) en Rust. Workspace Cargo avec 4 crates :

| Crate | Rôle |
|-------|------|
| `corewar-common` | Constantes, types, op_table, utilitaires partagés |
| `corewar-asm` | Assembleur — traduit les fichiers `.s` en bytecode `.cor` |
| `corewar-vm` | Machine virtuelle — exécute les champions dans l'arène |
| `corewar-disasm` | Désassembleur — traduit les `.cor` en `.s` |

## Compilation

```bash
cargo build
```

Les binaires se trouvent dans `target/debug/` : `asm`, `corewar`, `disasm`.

## Utilisation

```bash
# Assembleur : .s → .cor
./target/debug/asm champs/zork.s

# Désassembleur : .cor → .s
./target/debug/disasm champs/zork.cor

# Machine virtuelle
./target/debug/corewar --dump 1000 champs/zork.cor champs/big_feet.cor
./target/debug/corewar -v champs/zork.cor champs/big_feet.cor
```

---

## Protocole de test comparatif C vs Rust

### Prérequis — Compilation

```bash
# Terminal 1 — C
cd Corewar && make

# Terminal 2 — Rust
cd corewar-rust && cargo build
```

Vérifie que les binaires existent :

```bash
# C
ls -l ./corewar ./asm ./disasm

# Rust
ls -l ./target/debug/corewar ./target/debug/asm ./target/debug/disasm
```

---

### Test 1 — Assembleur : sortie binaire identique

Les deux assembleurs doivent produire des `.cor` **byte-à-byte identiques**.

```bash
# C
./asm champs/zork.s && md5sum champs/zork.cor

# Rust
./target/debug/asm champs/zork.s && md5sum champs/zork.cor
```

**Résultat attendu** : même hash MD5 = binaires identiques.

**Test en masse** (dans un seul terminal) :

```bash
# Assemble tout avec C
for f in champs/*.s; do ./asm "$f"; done
md5sum champs/*.cor > /tmp/c_asm.md5

# Assemble tout avec Rust
for f in champs/*.s; do ./target/debug/asm "$f"; done
md5sum champs/*.cor > /tmp/rust_asm.md5

# Compare
diff /tmp/c_asm.md5 /tmp/rust_asm.md5
```

**Si différence** : compare en détail un champion :

```bash
./asm champs/zork.s && cp champs/zork.cor /tmp/zork_c.cor
./target/debug/asm champs/zork.s && cp champs/zork.cor /tmp/zork_rust.cor
cmp -l /tmp/zork_c.cor /tmp/zork_rust.cor | head -20
```

---

### Test 2 — Désassembleur : sortie texte identique

```bash
# C (sort vers un fichier *-dis.s)
./disasm champs/zork.cor && cp champs/zork-dis.s /tmp/zork_c_dis.s

# Rust (sort aussi vers un fichier *-dis.s)
./target/debug/disasm champs/zork.cor && cp champs/zork-dis.s /tmp/zork_rust_dis.s

# Compare
diff /tmp/zork_c_dis.s /tmp/zork_rust_dis.s
```

**Résultat attendu** : aucune différence.

**Test en masse** :

```bash
# C
for f in champs/*.cor; do ./disasm "$f"; done
for f in champs/*-dis.s; do cp "$f" /tmp/c_$(basename "$f"); done

# Rust
for f in champs/*.cor; do ./target/debug/disasm "$f"; done
for f in champs/*-dis.s; do cp "$f" /tmp/rust_$(basename "$f"); done

# Compare
for f in /tmp/c_*-dis.s; do
    name=$(basename "$f")
    diff "$f" "/tmp/rust_$name" && echo "$name OK" || echo "$name DIFF"
done
```

---

### Test 3 — VM : Dump mémoire (LE TEST CLE)

C'est **le test le plus important** pour valider que la machine virtuelle exécute correctement. Les deux VM doivent produire une mémoire **identique** après N cycles.

#### Format de dump

Le C affiche en colonnes avec des offsets :
```
0x0000 : 0b 68 01 00 0f 00 01 06 64 01 00 00 00 00 01 01 00 00 00 01 09 ff fb 00 00 00 00 00 00 00 00 00
```

Le Rust affiche des lignes de 64 hex chars sans offsets :
```
0b6801000f00010664010000000001010000000109fffb000000000000000000
```

Il faut **normaliser** le format avant de comparer.

#### Script de comparaison de dump

Crée ce script `compare_dump.sh` à la racine du projet C :

```bash
#!/bin/bash
# Usage: ./compare_dump.sh <cycles> <champion1.cor> [champion2.cor] ...

CYCLES=$1
shift
CHAMPS="$@"

# Dump C -> extraire juste les hex, supprimer offsets et espaces
./corewar -dump $CYCLES $CHAMPS 2>/dev/null | \
    sed 's/.*: //' | tr -d ' \n' > /tmp/c_dump_${CYCLES}.hex

# Dump Rust -> concatener les lignes
./target/debug/corewar --dump $CYCLES $CHAMPS 2>/dev/null | \
    tr -d '\n' > /tmp/rust_dump_${CYCLES}.hex

# Comparer
if diff -q /tmp/c_dump_${CYCLES}.hex /tmp/rust_dump_${CYCLES}.hex > /dev/null 2>&1; then
    echo "OK - Dump identique a $CYCLES cycles"
else
    echo "ECHEC - DIFFERENCE a $CYCLES cycles !"
    # Trouver le premier octet different
    c_len=$(wc -c < /tmp/c_dump_${CYCLES}.hex)
    r_len=$(wc -c < /tmp/rust_dump_${CYCLES}.hex)
    echo "   C:    $c_len hex chars"
    echo "   Rust: $r_len hex chars"
    # Premier byte different
    cmp -l /tmp/c_dump_${CYCLES}.hex /tmp/rust_dump_${CYCLES}.hex | head -5
fi
```

```bash
chmod +x compare_dump.sh
```

#### Tests progressifs

Commence petit, puis augmente :

```bash
# 1 champion, cycle 0 (juste le chargement en memoire)
./compare_dump.sh 0 champs/zork.cor

# 1 champion, 100 cycles
./compare_dump.sh 100 champs/zork.cor

# 1 champion, 1000 cycles
./compare_dump.sh 1000 champs/zork.cor

# 2 champions, cycle 0 (chargement cote a cote)
./compare_dump.sh 0 champs/zork.cor champs/big_feet.cor

# 2 champions, 500 cycles (premieres instructions executees)
./compare_dump.sh 500 champs/zork.cor champs/big_feet.cor

# 2 champions, 5000 cycles (bataille en cours)
./compare_dump.sh 5000 champs/zork.cor champs/big_feet.cor

# 3+ champions
./compare_dump.sh 5000 champs/zork.cor champs/big_feet.cor champs/live.cor
```

**Pourquoi progressif ?** Si le dump differe a cycle 0, le probleme est dans le **chargement**. Si c'est OK a 0 mais pas a 100, c'est dans l'**execution des opcodes**. Si ca marche jusqu'a 5000, c'est probablement OK.

#### Test de non-regression automatisé

```bash
for cycles in 0 10 100 500 1000 2000 5000 10000; do
    ./compare_dump.sh $cycles champs/zork.cor champs/big_feet.cor
done
```

---

### Test 4 — VM : Verification du vainqueur

```bash
# C -- sans ncurses, avec verbosity
./corewar -v champs/zork.cor champs/big_feet.cor 2>&1 | tail -3

# Rust -- avec verbosity
./target/debug/corewar -v champs/zork.cor champs/big_feet.cor 2>&1 | tail -3
```

**Resultat attendu** : meme joueur declare gagnant.

---

### Test 5 — Roundtrip complet

Verifie que asm -> disasm -> asm donne le meme binaire :

```bash
# Rust uniquement
./target/debug/asm champs/zork.s
cp champs/zork.cor /tmp/zork_rt1.cor

./target/debug/disasm champs/zork.cor
./target/debug/asm champs/zork-dis.s
cp champs/zork-dis.cor /tmp/zork_rt2.cor

diff /tmp/zork_rt1.cor /tmp/zork_rt2.cor && echo "Roundtrip OK" || echo "Roundtrip casse"
```

---

### Recapitulatif des commandes rapides

| Ce que tu testes | Commande |
|---|---|
| Assembleur 1 fichier | `./asm champs/zork.s && md5sum champs/zork.cor` vs `./target/debug/asm champs/zork.s && md5sum champs/zork.cor` |
| Assembleur en masse | `diff <(for f in champs/*.s; do ./asm "$f"; done; md5sum champs/*.cor) <(for f in champs/*.s; do ./target/debug/asm "$f"; done; md5sum champs/*.cor)` |
| Desassembleur | `diff <(./disasm champs/zork.cor > /dev/null; cat champs/zork-dis.s) <(./target/debug/disasm champs/zork.cor > /dev/null; cat champs/zork-dis.s)` |
| VM dump | `./compare_dump.sh 1000 champs/zork.cor champs/big_feet.cor` |
| Vainqueur | Comparer la sortie `-v` des deux VM |

---

## Bugs corriges lors de la traduction

| Bug | Fichier | Description |
|-----|---------|-------------|
| Header .cor +2 octets | `codegen.rs` | `PROG_NAME_LENGTH+1` et `COMMENT_LENGTH+1` au lieu de `PROG_NAME_LENGTH` et `COMMENT_LENGTH` |
| Desassembleur tronque | `types.rs` | `Header::from_bytes` lisait 129 octets pour le nom au lieu de 128 |
| header_size() faux | `types.rs` | Retournait 2194 au lieu de 2192 (4+128+4+4+2048+4) |
| +3 offset hallucination | `vm.rs` | `op_sti` et `op_st` avaient un `+3` errone sur les adresses de stockage |
| kill_zombies O(N^2) | `vm.rs` | `Vec::remove(i)` dans une boucle remplace par `retain_mut` en O(N) |
| Lexer sans espace | `lexer.rs` | `fork%:label` non reconnu car `%` n'etait pas un delimiteur d'opcode |
| Code mort | `parser.rs`, `error.rs`, `lexer.rs` | Champ `mem_pos` et variantes `Syntax`/`Other` inutilises supprimes |
