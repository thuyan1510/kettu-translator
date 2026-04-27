import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
    input: 'src/index.tsx',
    output: {
        file: 'dist/index.js',
        format: 'iife',
        globals: {
            'react': 'Kettu.react',
            '@bunny/metro': 'Kettu.metro',
            '@bunny/ui': 'Kettu.ui'
        }
    },
    plugins: [
        typescript(),
        commonjs(),
        nodeResolve({ browser: true })
    ],
    external: ['react', '@bunny/metro', '@bunny/ui']
};
