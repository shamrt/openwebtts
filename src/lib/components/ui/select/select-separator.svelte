<script lang="ts">
	import { Separator } from "$lib/components/ui/separator/index.js";
	import { cn } from "$lib/utils.js";
	import type { Separator as SeparatorPrimitive } from "$lib/vendor/bits-ui/dist/index.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SeparatorPrimitive.RootProps = $props();
</script>

<Separator
	bind:ref
	data-slot="select-separator"
	class={cn("-mx-1 my-1 h-px bg-border pointer-events-none", className)}
	{...restProps}
/>
