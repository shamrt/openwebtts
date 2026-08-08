<script lang="ts">
	import { Select as SelectPrimitive } from "$lib/vendor/bits-ui/dist/index.js";
	import { cn } from "$lib/utils.js";

	let {
		class: className,
		...restProps
	}: SelectPrimitive.ValueProps = $props();
</script>

<SelectPrimitive.Value class={cn(className)} {...restProps} />