<script lang="ts">
	import { Select as SelectPrimitive } from "$lib/vendor/bits-ui/dist/index.js";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SelectPrimitive.GroupProps = $props();
</script>

<SelectPrimitive.Group
	bind:ref
	data-slot="select-group"
	class={cn("scroll-my-1 p-1", className)}
	{...restProps}
/>
